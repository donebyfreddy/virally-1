import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

// Remotion's bundler entry. Kept separate from Root.tsx so the component can be
// imported by tests and by the studio preview without registering a root as a
// side effect.
registerRoot(RemotionRoot);
