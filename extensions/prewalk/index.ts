import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPrewalk } from "../../src/prewalk.ts";
import { createTrajectoryRouter } from "../../src/trajectory-router/index.ts";

export default function piPrewalk(pi: ExtensionAPI): void {
  const router = createTrajectoryRouter(pi);
  registerPrewalk(pi, router);
}
