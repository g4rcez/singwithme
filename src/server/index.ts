import app from "../web/index.html";
import { startServer } from "./app";

// Local entry point: Bun bundles the interface on the fly, with hot reload in `bun dev`.
startServer({ "/": app });
