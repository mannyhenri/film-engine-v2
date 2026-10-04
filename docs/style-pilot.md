# How style conditioning works, and how the pilot tests it (GRD-4664)

## What "your style" means here

Film Engine uses **inference-time conditioning**. When it drafts, it puts your approved guidance,
your style traits, and a few of your own permitted example excerpts into the prompt for the model.
No model is trained on your writing; no weights change. Remove the context, and the model writes as
it always did.

Its limits, plainly:

- It can only steer toward what your approved guidance, traits and examples show. A category with
  no evidence (see Coverage) stays unknown, and drafts are told not to infer it.
- It cannot guarantee your voice. The model may drift, flatten, or imitate surface features such as
  sentence length while missing what makes the writing yours.
- Examples are reference, not text to copy. The pilot checks for long-form reuse: 12 or more
  consecutive words from a source sample.
- Scene instructions, screenplay facts and characters' declared voices take precedence over style.
- What is sent to a provider is what you approved in the preview, and nothing else.

## The pilot

The pilot answers one question: with the same model and the same brief, do you prefer the draft that
used your style context?

1. **Held-out briefs.** Choose at least 10 held-out samples (Hold out, in Learn my style), across the
   sample types you care about. Write one brief for each. Held-out samples are never used in drafts.
   Development samples that nearly repeat a target are found automatically and kept out of the
   context too. If your approved profile is built on one of them, the pilot refuses to run until
   you revise the profile.
2. **Agree the success criterion first.** For example: "conditioned wins at least 6 of 10, and no
   rubric dimension gets worse". It is fixed once agreed.
3. **Blind review.** Each brief produces two drafts, one conditioned and one not, from the same
   model. They appear left and right in random order. Pick the one that sounds like you (or call a
   tie), and score both on correctness, character consistency, subtext, pacing, action clarity,
   description, and sounds-like-me.
4. **The report** gives exact versions, sample size, wins, ties and losses, the rubric means for each
   condition, regressions, exclusions and reuse flags. Mixed results are reported as mixed. An
   **AI judge** may be recorded for reference, but it never counts toward the results or the
   decision.
5. **Release gate.** You release or hold the candidate, against the exact report you read. A held
   candidate stays pending until it is revised or there is better evidence.
6. **Activation.** A separate step after release, also yours.
