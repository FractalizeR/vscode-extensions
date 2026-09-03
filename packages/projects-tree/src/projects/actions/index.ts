// Public surface of the actions subject. Sibling subjects (classification/, discovery/) must go
// through this file rather than importing actions/*'s internals directly — machine-checked by
// dependency-cruiser's no-sibling-internals rule.

export type {
  ActionDefinition,
  ActionSpec,
  RenderErrorReason,
  RenderTarget,
  ShellKind,
} from './action';
export { RenderError } from './action';
export type { ActionRenderNode } from './render';
export { render, renderArgs, renderCommandArgs } from './render';
export { encodeForUri, quoteForShell } from './quoting';
