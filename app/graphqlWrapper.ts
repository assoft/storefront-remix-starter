import { DocumentNode, print } from "graphql";
import { getSdk } from "./generated/graphql";
import { sessionStorage } from './sessions';

const DEMO_API_URL = 'https://readonlydemo.vendure.io/shop-api';

export interface QueryOptions {
  request: Request;
}

export interface GraphqlResponse<Response> {
  errors: any[];
  data: Response;
}

const AUTH_TOKEN_SESSION_KEY = 'authToken';

async function sendQuery<Response, Variables = {}>(
  options: { query: string; variables?: Variables, headers?: Headers, request?: Request }
): Promise<GraphqlResponse<Response> & { headers: Headers }> {
  const headers = new Headers(options.headers);
  headers.append("Content-Type", "application/json");
  const session = await sessionStorage.getSession(options.request?.headers.get('Cookie'));
  if (session) {
    // If we have a vendure auth token stored in the Remix session, then we
    // add it as a bearer token to the API request being sent to Vendure.
    const token = session.get(AUTH_TOKEN_SESSION_KEY);
    if (token) {
      headers.append("Authorization", `Bearer ${token}`);
    }
  }

  return fetch(process.env.VENDURE_API_URL ?? DEMO_API_URL, {
    method: "POST",
    body: JSON.stringify(options),
    credentials: "include",
    headers,
  }).then(async (res) => ({
    ...(await res.json()),
    headers: res.headers,
  }))
}

const baseSdk = getSdk<QueryOptions>(requester);

type Sdk = typeof baseSdk;
type SdkWithHeaders = {
  [k in keyof Sdk]: (
    ...args: Parameters<Sdk[k]>
  ) => Promise<Awaited<ReturnType<Sdk[k]>> & { _headers: Headers }>;
};

export const sdk: SdkWithHeaders = baseSdk as any;

function requester<R, V>(
  doc: DocumentNode,
  vars?: V,
  options?: { headers?: Headers; request?: Request }
): Promise<R & { _headers: Headers }> {
  return sendQuery<R, V>(
    {query: print(doc), variables: vars, ...options},
  ).then(async (response) => {
    const token = response.headers.get('vendure-auth-token');
    const headers: Record<string, string> = {};
    if (token) {
      // If Vendure responded with an auth token, it means a new Vendure session
      // has started. In this case, we will store that auth token in the Remix session
      // so that we can attach it as an Authorization header in all subsequent requests.
      const session = await sessionStorage.getSession(options?.request?.headers.get('Cookie'));
      if (session) {
        session.set(AUTH_TOKEN_SESSION_KEY, token);
        headers['Set-Cookie'] = await sessionStorage.commitSession(session);
      }
    }
    if (response.errors) {
      console.log(
        response.errors[0].extensions.exception.stacktrace.join("\n")
      );
      throw new Error(response.errors[0].message);
    }
    return {...response.data, _headers: new Headers(headers)};
  })
}
