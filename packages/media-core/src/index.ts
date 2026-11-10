import registry from "../format-registry.json";

/**
 * The checked-in JSON file is the single runtime registry shared with native
 * Node.js (which cannot directly import the browser TypeScript package).
 * An output format is a tested codec/container profile, not a filename suffix.
 */
export const REGISTRY_VERSION = 1 as const;
export const RECIPE_VERSION = 1 as const;
export const FORMAT_IDS = ["mp4", "webm", "mov", "mp3", "wav", "flac", "gif"] as const;
export type FormatId = (typeof FORMAT_IDS)[number];
export type BrowserFormatId = Exclude<FormatId, "gif">;
export type Engine = "browser" | "native";
export type FormatGroup = "video" | "audio" | "image";
export type BrowserCodec = "avc" | "vp9" | "aac" | "opus" | "mp3" | "pcm-s16" | "flac";

export type FormatDefinition<Id extends FormatId = FormatId> = {
  id: Id;
  label: string;
  group: FormatGroup;
  detail: string;
  description: string;
  mime: string;
  browser: boolean;
  native: boolean;
  browserVideoCodec?: BrowserCodec;
  browserAudioCodec?: BrowserCodec;
  nativeVideoCodec?: string;
  nativeAudioCodec?: string;
};

const ids = new Set<string>(FORMAT_IDS);
export function isFormatId(value: string): value is FormatId {
  return ids.has(value);
}

if (registry.version !== REGISTRY_VERSION || registry.formats.length !== FORMAT_IDS.length) {
  throw new Error("Invalid media format registry version or size");
}
const seen = new Set<string>();
for (const format of registry.formats) {
  if (!isFormatId(format.id) || seen.has(format.id)) {
    throw new Error("Invalid or duplicate media format in registry");
  }
  seen.add(format.id);
}

export const FORMAT_CATALOG: readonly FormatDefinition[] = Object.freeze(
  (registry.formats as unknown as FormatDefinition[]).map((format) => Object.freeze(format)),
);
export const BROWSER_FORMATS: readonly FormatDefinition<BrowserFormatId>[] =
  FORMAT_CATALOG.filter((format) => format.browser) as FormatDefinition<BrowserFormatId>[];
export const NATIVE_FORMATS: readonly FormatDefinition[] = FORMAT_CATALOG.filter((format) => format.native);

export function getFormatDefinition(id: FormatId): FormatDefinition {
  const found = FORMAT_CATALOG.find((format) => format.id === id);
  if (!found) throw new Error("Unsupported format");
  return found;
}

export type MediaFacts = {
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  canDecodeVideo: boolean;
  canDecodeAudio: boolean;
  /** Only true/false when a browser codec probe has actually run. */
  encoderSupport?: Partial<Record<BrowserCodec, boolean>>;
};

export type NativeCapabilities = {
  available: boolean;
  formats: readonly string[];
  maxUploadBytes: number;
  maxDurationSeconds: number;
  maxDimension: number;
};

export type PlanningOptions = {
  localMaxBytes: number;
  native?: NativeCapabilities;
};

export type SupportStatus = "ready" | "needs-check" | "blocked";
export type SupportReason =
  | "engine-disabled" | "no-video" | "no-audio" | "local-size-limit"
  | "video-decoder-unavailable" | "audio-decoder-unavailable"
  | "video-encoder-unavailable" | "audio-encoder-unavailable"
  | "video-encoder-unverified" | "audio-encoder-unverified"
  | "stream-copy-unverified" | "native-offline" | "native-format-unavailable"
  | "native-size-limit" | "native-duration-limit" | "native-dimension-limit"
  | "native-input-unverified";

export type RouteDecision = {
  status: SupportStatus;
  reasons: readonly SupportReason[];
};

export type ExportPlan = {
  format: FormatDefinition;
  browser: RouteDecision;
  native: RouteDecision;
  /** Preference, not permission to move file bytes. Upload still needs consent. */
  recommendedEngine: Engine | null;
  requiresUploadConsent: boolean;
};

function decide(blocked: SupportReason[], checks: SupportReason[]): RouteDecision {
  if (blocked.length) return { status: "blocked", reasons: blocked };
  if (checks.length) return { status: "needs-check", reasons: checks };
  return { status: "ready", reasons: [] };
}

function missingStreams(format: FormatDefinition, source: MediaFacts): SupportReason[] {
  if (format.group === "audio") return source.hasAudio ? [] : ["no-audio"];
  if (format.group === "video" || format.group === "image") {
    return source.hasVideo ? [] : ["no-video"];
  }
  return ["engine-disabled"];
}

function browserDecision(format: FormatDefinition, source: MediaFacts, limit: number): RouteDecision {
  const blocked: SupportReason[] = missingStreams(format, source);
  const checks: SupportReason[] = [];
  if (!format.browser) blocked.push("engine-disabled");
  if (!Number.isFinite(source.sizeBytes) || source.sizeBytes <= 0 || source.sizeBytes > limit) {
    blocked.push("local-size-limit");
  }
  if (format.group === "video" && !source.canDecodeVideo) blocked.push("video-decoder-unavailable");
  if ((format.group === "audio" || (format.group === "video" && source.hasAudio)) &&
      !source.canDecodeAudio) blocked.push("audio-decoder-unavailable");

  if (format.browserVideoCodec && source.hasVideo) {
    const status = source.encoderSupport?.[format.browserVideoCodec];
    if (status === false) {
      // Conversion.init may choose stream-copy for a matching source codec.
      // Never claim this path is verified before the actual conversion plan.
      if (source.videoCodec === format.browserVideoCodec) checks.push("stream-copy-unverified");
      else blocked.push("video-encoder-unavailable");
    } else if (status === undefined) checks.push("video-encoder-unverified");
  }
  if (format.browserAudioCodec && source.hasAudio) {
    const status = source.encoderSupport?.[format.browserAudioCodec];
    if (status === false) blocked.push("audio-encoder-unavailable");
    else if (status === undefined) checks.push("audio-encoder-unverified");
  }
  return decide(blocked, checks);
}

function nativeDecision(format: FormatDefinition, source: MediaFacts, native?: NativeCapabilities): RouteDecision {
  const blocked: SupportReason[] = missingStreams(format, source);
  const checks: SupportReason[] = [];
  if (!format.native) blocked.push("engine-disabled");
  if (!native?.available) return decide([...blocked, "native-offline"], checks);
  if (!native.formats.includes(format.id)) blocked.push("native-format-unavailable");
  if (!Number.isFinite(source.sizeBytes) || source.sizeBytes <= 0 ||
      source.sizeBytes > native.maxUploadBytes) blocked.push("native-size-limit");
  if (source.durationSeconds !== null &&
      source.durationSeconds > native.maxDurationSeconds) blocked.push("native-duration-limit");
  if ((source.width !== null && source.width > native.maxDimension) ||
      (source.height !== null && source.height > native.maxDimension)) blocked.push("native-dimension-limit");
  // Native FFprobe validates each upload. Client-side metadata is not proof
  // that an arbitrary input can be decoded by the installed FFmpeg build.
  checks.push("native-input-unverified");
  return decide(blocked, checks);
}

export function planMediaExports(source: MediaFacts, options: PlanningOptions): ExportPlan[] {
  return FORMAT_CATALOG.map((format) => {
    const browser = browserDecision(format, source, options.localMaxBytes);
    const native = nativeDecision(format, source, options.native);
    const recommendedEngine: Engine | null =
      browser.status !== "blocked" ? "browser"
        : native.status !== "blocked" ? "native" : null;
    return {
      format, browser, native, recommendedEngine,
      requiresUploadConsent: recommendedEngine === "native",
    };
  });
}

export function recommendFormat(plans: readonly ExportPlan[], source: MediaFacts): FormatId | null {
  const order: FormatId[] = source.hasVideo
    ? ["mp4", "webm", "mov", "gif"]
    : ["mp3", "wav", "flac"];
  for (const id of order) {
    if (plans.find((plan) => plan.format.id === id && plan.recommendedEngine !== null)) return id;
  }
  return null;
}

/** Intent-level recipe; neither adapter accepts arbitrary FFmpeg flags. */
export const QUALITY_INTENTS = ["preserve", "balanced", "smaller"] as const;
export type QualityIntent = (typeof QUALITY_INTENTS)[number];
export const HEIGHT_LIMITS = [null, 480, 720, 1080] as const;
export type HeightLimit = (typeof HEIGHT_LIMITS)[number];
export type ConversionRecipeV1 = Readonly<{
  version: typeof RECIPE_VERSION;
  format: FormatId;
  quality: QualityIntent;
  maxHeight: HeightLimit;
}>;

export function createRecipe(
  format: string, quality: string = "balanced", maxHeight: number | null = null,
): ConversionRecipeV1 {
  if (!isFormatId(format)) throw new Error("Unsupported format");
  if (!(QUALITY_INTENTS as readonly string[]).includes(quality)) throw new Error("Unsupported quality");
  if (!(HEIGHT_LIMITS as readonly (number | null)[]).includes(maxHeight)) {
    throw new Error("Unsupported height limit");
  }
  return Object.freeze({
    version: RECIPE_VERSION, format,
    quality: quality as QualityIntent, maxHeight: maxHeight as HeightLimit,
  });
}

export function toBrowserSettings(recipe: ConversionRecipeV1): {
  preset: BrowserFormatId;
  quality: "source" | "balanced" | "compact";
  height: "original" | "480" | "720" | "1080";
} {
  if (!getFormatDefinition(recipe.format).browser) throw new Error("Not a browser preset");
  return {
    preset: recipe.format as BrowserFormatId,
    quality: recipe.quality === "preserve" ? "source" : recipe.quality === "smaller" ? "compact" : "balanced",
    height: recipe.maxHeight === null ? "original" : String(recipe.maxHeight) as "480" | "720" | "1080",
  };
}

export function toNativeSettings(recipe: ConversionRecipeV1): {
  format: FormatId;
  quality: "high" | "balanced" | "small";
  height: HeightLimit;
} {
  if (!getFormatDefinition(recipe.format).native) throw new Error("Not a native preset");
  return {
    format: recipe.format,
    quality: recipe.quality === "preserve" ? "high" : recipe.quality === "smaller" ? "small" : "balanced",
    height: recipe.maxHeight,
  };
}
