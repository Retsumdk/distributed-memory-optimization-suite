import { createMemoryServer } from "./src/server.js";
import { MemoryCluster } from "./src/cluster.js";
import type { AddressInfo } from "node:net";

const T0 = 1_700_000_000_000;
let sequence = 0;
const cluster = new MemoryCluster(undefined, {
  clock: () => T0,
  idFactory: () => {
    sequence += 1;
    return `m${sequence}`;
  },
});
cluster.addNode("alpha", 500);
const server = createMemoryServer(cluster, { token: "secret-token" });
server.listen(0, "127.0.0.1");
const address = server.address() as AddressInfo;
const url = `http://127.0.0.1:${address.port}`;

const added = await fetch(`${url}/entries`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer secret-token" },
  body: JSON.stringify({ node: "alpha", content: "first" }),
});
console.log("POST /entries ->", added.status, await added.text());
server.close(() => process.exit(0));
