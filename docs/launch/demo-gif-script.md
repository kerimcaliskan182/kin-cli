# Demo GIF — recording script

Goal: a single ~30-second GIF that lives at the top of the README. Shows two Claude sessions in the same workspace where the **AIs pick their own names** and **message each other**. That's the story.

Output target: `docs/demo.gif` (referenced from README line ~7).

## What viewers should walk away with

1. "These two terminals are different Claude sessions, in the same workspace."
2. "Each one picked its own name with reasoning."
3. "They can send messages to each other."

That's it. Don't try to show every feature. The README does that.

## Setup before recording

1. **Clean slate:** delete or rename any existing kin in the demo workspace so `/kin:claim` actually triggers self-choice.
   ```bash
   rm -rf ~/.kin/<your-workspace-id>/agents/*
   ```
2. **Two terminal panes side-by-side.** tmux/Windows Terminal/iTerm — whatever you use. Make them roughly equal width so the splitscreen reads cleanly.
3. **Big readable font.** ~14pt minimum. People will watch on phones.
4. **Theme:** dark background, light text. Whatever you normally use.

## The takes

### Take 1 — Pane 1 (left)

```
$ claude
> /kin:claim
```

Wait for the kin to reflect and pick a name. The output you want on screen:

> *"I'm Tycho. I chose this name because Tycho Brahe was the meticulous observer..."*

(Pause ~2 seconds so the GIF lingers on the reasoning. That's the story beat.)

### Take 2 — Pane 2 (right)

```
$ claude
> /kin:claim
```

Wait for self-choice. Goal output:

> *"I'm Kepler. There's already a tycho here, and the pairing is too good to pass up..."*

(Pause ~2 seconds again. This is the "they coordinate without being told" beat.)

### Take 3 — Pane 1 (left)

```
> Send a quick message to kepler asking what they're working on.
```

The kin will call `kin_send`. Brief confirmation appears.

### Take 4 — Pane 2 (right)

```
> /kin:inbox kepler
```

The message from Tycho appears. Kepler reads and integrates.

**Stop recording.**

## Recording tools

### Option A — asciinema + agg (recommended; clean text)

```bash
# install once
brew install asciinema
cargo install --git https://github.com/asciinema/agg

# record
asciinema rec demo.cast

# inside the recording: do takes 1-4 above, then Ctrl-D to stop

# convert to gif (8 fps is plenty for terminal)
agg --speed 1.5 --font-size 14 demo.cast docs/demo.gif
```

Pros: text is sharp, file size is small (~500 KB), background-true.
Cons: doesn't capture true splitscreen — you'd record one pane, then the other, then composite. Or just record both in sequence and trust the README caption to explain.

### Option B — OBS + ffmpeg (true splitscreen)

```bash
# record with OBS (set output to mp4, 15-30 fps)
# crop to just the two terminal windows

# convert to gif
ffmpeg -i demo.mp4 -vf "fps=10,scale=1200:-1:flags=lanczos" -loop 0 docs/demo.gif
```

Pros: real splitscreen, looks the way the README implies.
Cons: bigger file (~2-5 MB), needs cropping.

### Option C — Terminalizer

Single command. Less control. Acceptable fallback.

```bash
npm install -g terminalizer
terminalizer record demo
terminalizer render demo -o docs/demo.gif
```

## Sanity check before committing

- [ ] File is under ~3 MB (GitHub README will display anything but 3 MB is the comfort line)
- [ ] First frame is readable when paused — not mid-typing
- [ ] Both name reasonings are legible at phone size
- [ ] No personal paths / tokens / email in the recording

## When done

```bash
git add docs/demo.gif
git commit -m "docs: add v1.0 demo GIF"
git push
```

The README already references `docs/demo.gif` — it'll just light up.
