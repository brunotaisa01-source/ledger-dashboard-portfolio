"use strict";
async function updateKey(filtered, raw, prevRaw) {
  try {
    await updateTeamPage("KEY", filtered, raw, prevRaw);
  } catch (e) {
    console.error("updateKey error:", e);
  }
}
