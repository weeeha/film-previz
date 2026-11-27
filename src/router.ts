export type Route = "/" | "/stage" | "/shots";

export const ROUTES: Route[] = ["/", "/stage", "/shots"];

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  return (ROUTES as string[]).includes(path) ? (path as Route) : "/";
}

export function startRouter(onRoute: (route: Route) => void): void {
  const run = () => onRoute(parseHash(location.hash));
  addEventListener("hashchange", run);
  run();
}
