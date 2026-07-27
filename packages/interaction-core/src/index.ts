export type { SessionTimeMs } from "./time/session-time";
export { toSessionTimeMs } from "./time/session-time";

export type { InteractionTimeProvider } from "./clock/interaction-clock";
export { InteractionClock } from "./clock/interaction-clock";

export type { TimedTimelineEntry } from "./timeline/ring-buffer";
export { RingBuffer } from "./timeline/ring-buffer";
export { GazeTimeline } from "./timeline/gaze-timeline";
export type { InteractionTimelineOptions } from "./timeline/interaction-timeline";
export { InteractionTimeline } from "./timeline/interaction-timeline";

export type { TimedGazeSample } from "./types/timed-gaze-sample";
