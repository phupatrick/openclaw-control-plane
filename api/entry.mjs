import { handleRequest } from "../server.mjs";

export default async function handler(req, res) {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const route = requestUrl.searchParams.get("route") || "/";
  requestUrl.searchParams.delete("route");
  const query = requestUrl.searchParams.toString();
  req.url = `${route}${query ? `?${query}` : ""}`;
  return handleRequest(req, res);
}
