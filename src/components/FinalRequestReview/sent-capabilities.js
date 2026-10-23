// What the final review SENDS instead of handing over: the user's rulings, mirrored from backend/lib/manual-generation.js
// SENT (the server enforces it; this only decides which footer the review shows). Held equal by FinalRequestReview.test.
export const SENT = Object.freeze({ meshy: Object.freeze(['model3d']) });
export const isSent = snapshot => !!SENT[snapshot?.provider]?.includes(snapshot?.capability);
