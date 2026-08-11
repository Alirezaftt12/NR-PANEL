import { buildApp } from "./app.js";
import { environment } from "./lib/environment.js";

const app = await buildApp();

try {
  await app.listen({ port: environment.apiPort, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
