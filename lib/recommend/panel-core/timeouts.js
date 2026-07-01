export const PANEL_MODEL_TIMEOUT_SECONDS = Math.max(
  120,
  Number.parseInt(process.env.OMO_PANEL_MODEL_TIMEOUT_SECONDS || "180", 10) ||
    180,
);

export const PANEL_FIRST_BYTE_TIMEOUT_SECONDS = Math.max(
  60,
  Number.parseInt(
    process.env.OMO_PANEL_FIRST_BYTE_TIMEOUT_SECONDS ||
      String(PANEL_MODEL_TIMEOUT_SECONDS),
    10,
  ) || PANEL_MODEL_TIMEOUT_SECONDS,
);
