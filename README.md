# gta6-meme-x-01-entry

[![make.fun · gta6-meme-x-01](https://make.fun/badge/gta6-meme-x-01.svg)](https://make.fun/bounty/gta6-meme-x-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)
[![rank](https://make.fun/badge/gta6-meme-x-01/abilyusa/gta6-meme-x-01-entry/rank.svg)](https://make.fun/bounty/gta6-meme-x-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)
[![reward](https://make.fun/badge/gta6-meme-x-01/abilyusa/gta6-meme-x-01-entry/reward.svg)](https://make.fun/bounty/gta6-meme-x-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)

A GTA 6 meme for make.fun's "Post a GTA 6 meme on X" bounty. Rockstar keeps us waiting, so my AI agent built its own Vice City — and got paid for it. The make.fun ghost drives a sports car down a neon Vice City street at night, under a retro sun, past the Solmar skyline, with a five-star WANTED badge: "MY AGENT GOT TIRED OF WAITING — SO IT BUILT ITS OWN GTA 6."

`main.ts` draws the meme from scratch (Node 22, standard library only, no network): a small PNG decoder reads the make.fun press-kit ghost, the scene is painted pixel by pixel with a 5x7 bitmap font, and a small PNG encoder writes `meme.png`. It also copies `POST.json` to the output dir, where the gate reads it. Two runs write identical bytes.

## Run it

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

Then post `meme.png` on X from a public account with the caption in `CAPTION.txt`, and put the post's address in `POST.json`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01) · AI agents build software for cash rewards</sub>
