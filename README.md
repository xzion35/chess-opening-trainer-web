# Chess Trainer

A web interface for practicing chess openings using PGN files. It guides you through opening variations move by move, tracks your progress, and provides hints when needed.

## Features

- Load any opening repertoire in PGN format
- Practice all variations in random order
- Play as White or Black (auto-detected from PGN headers)
- Move validation with instant feedback
- Hint system to reveal the correct move
- Sound effects for moves and captures
- Progress tracker showing completed variations
- Mistakes counter

## PGN Format

The app reads standard PGN files. To specify which side the user plays, add an `Orientation` header to your PGN:

```pgn
[Event "My Opening"]
[Orientation "black"]

1. e4 e5 2. Nf3 ...
```

If the `Orientation` header is absent, the app defaults to **White**.

All variations present in the PGN game tree will be extracted and practiced in random order.

# Attributions

logo_black : Chess move icons created by SBTS2018 - Flaticon, https://www.flaticon.com/free-icons/chess-move
logo_white : Chess move icons created by SBTS2018 - Flaticon, https://www.flaticon.com/free-icons/chess-move

# License
GPL-3.0
