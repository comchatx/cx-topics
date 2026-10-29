# Changelog

## 0.1.4 (unreleased)

- A title is written by the model the seller is chatting on, read from pi at each title call. On a physical model the call is as before, at most 128 output tokens with no thinking; on a virtual model the seller selected, pi routes it (`streamSimple`) and the thinking level the seller's router returns applies, pi adding its budget to the 128, since pi 1.4.0 offers an extension no public way to route and then bound a request; `TITLE_MODEL` (`balance` `minimax/minimax-m3`) is gone, and where the session has no model, or pi holds no key for it, no title is written.
- `package.json`'s `comchatx` field names Jev in `builds`, so the Plugins page lists it among the plugins this one uses.
