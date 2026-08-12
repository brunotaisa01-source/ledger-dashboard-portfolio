"use strict";

const fs = require("fs");
const path = require("path");

const dir = path.join("dashboard", "js");
const maxAttempts = 8;
const delayMs = 500;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeWithRetry(filePath) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      fs.unlinkSync(filePath);
      return;
    } catch (err) {
      if (!["EBUSY", "EPERM", "EACCES"].includes(err.code) || attempt === maxAttempts) {
        throw err;
      }
      sleep(delayMs);
    }
  }
}

if (fs.existsSync(dir)) {
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith(".js") || file.endsWith(".map")) {
      removeWithRetry(path.join(dir, file));
    }
  }
}
