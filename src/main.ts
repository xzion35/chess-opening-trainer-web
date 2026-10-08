import './style.css';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';

import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { makeSan, parseSan } from 'chessops/san';
import { parsePgn } from 'chessops/pgn';
import type { Node, PgnNodeData } from 'chessops/pgn';
import { parseSquare, squareRank } from 'chessops/util';
import { chessgroundDests, chessgroundMove } from 'chessops/compat';
import type { Color, Move, NormalMove, Role } from 'chessops/types';

// ---------------------------------------------------------------------------
// Éléments de l'UI
// ---------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const boardEl = $<HTMLDivElement>('board');
const pgnInput = $<HTMLInputElement>('pgn');
const resetBtn = $<HTMLButtonElement>('reset');
const hintBtn = $<HTMLButtonElement>('hint');
const statusEl = $<HTMLSpanElement>('status');
const progressEl = $<HTMLSpanElement>('progress');
const mistakesEl = $<HTMLSpanElement>('mistakes');
const promoEl = $<HTMLDivElement>('promo');

// ---------------------------------------------------------------------------
// Gestion des sons
// ---------------------------------------------------------------------------
const moveSound = new Audio(`${import.meta.env.BASE_URL}Sound/Move.wav`);
const captureSound = new Audio(`${import.meta.env.BASE_URL}Sound/Capture.wav`);
moveSound.volume = captureSound.volume = 0.5;

function playSound(isCapture: boolean) {
  const sound = isCapture ? captureSound : moveSound;
  sound.currentTime = 0;
  sound.play().catch(() => {}); // ignoré si le navigateur bloque l'audio
}

// ---------------------------------------------------------------------------
// État du jeu
// ---------------------------------------------------------------------------
let pos = Chess.default();
let variation: string[] | null = null; // ligne en cours (liste de SAN)
let variations: string[][] = []; // lignes restantes à travailler
let totalVariations = 0;
let userColor: Color = 'white';
let moveNumber = 1; // index (base 1) du prochain coup dans la ligne
let streak = 0;
let mistakes = 0;
let lastMove: Key[] | undefined;
let locked = false; // plateau bloqué (ligne ou entraînement terminé)
let awaitingNext = false; // le bouton sert à passer à la variante suivante

// ---------------------------------------------------------------------------
// Échiquier
// ---------------------------------------------------------------------------
const cg = Chessground(boardEl, {
  fen: makeFen(pos.toSetup()),
  premovable: { enabled: false },
  movable: {
    free: false,
    events: { after: (orig, dest) => void onUserMove(orig, dest) },
  },
});

/** Synchronise Chessground avec la position courante `pos`. */
function syncBoard() {
  const userTurn = pos.turn === userColor && !locked;
  cg.set({
    fen: makeFen(pos.toSetup()),
    orientation: userColor,
    turnColor: pos.turn,
    check: pos.isCheck(),
    lastMove,
    movable: {
      color: userTurn ? userColor : undefined,
      dests: userTurn ? chessgroundDests(pos) : new Map(),
    },
  });
}

// ---------------------------------------------------------------------------
// PGN -> variantes
// ---------------------------------------------------------------------------
/** Retire les suffixes (+, #, !, ?) pour comparer les SAN sans fausse différence. */
const norm = (san: string) => san.replace(/[+#!?]/g, '');

/** Parcourt l'arbre PGN et renvoie toutes les lignes racine -> feuille. */
function extractVariations(root: Node<PgnNodeData>): string[][] {
  const lines: string[][] = [];
  const stack: [Node<PgnNodeData>, string[]][] = [[root, []]];
  while (stack.length) {
    const [node, moves] = stack.pop()!;
    if (node.children.length === 0) {
      if (moves.length) lines.push(moves);
      continue;
    }
    for (const child of node.children) {
      stack.push([child, [...moves, norm(child.data.san)]]);
    }
  }
  return lines;
}

function chooseVariation() {
  const i = Math.floor(Math.random() * variations.length);
  variation = variations.splice(i, 1)[0];
}

pgnInput.addEventListener('change', async () => {
  const file = pgnInput.files?.[0];
  pgnInput.value = ''; // permet de recharger le même fichier
  if (!file) return;

  let lines: string[][] = [];
  let orientation = 'white';
  try {
    const game = parsePgn(await file.text())[0]; // premier jeu uniquement
    if (game) {
      lines = extractVariations(game.moves);
      orientation = (game.headers.get('Orientation') ?? 'white').toLowerCase();
    }
  } catch {
    lines = [];
  }
  if (lines.length === 0) {
    setStatus('⚠️ Incorrect file type');
    return;
  }

  userColor = orientation === 'black' ? 'black' : 'white';
  variations = lines;
  totalVariations = lines.length;
  streak = 0;
  mistakes = 0;
  mistakesEl.textContent = '';
  setStatus('');
  hintBtn.disabled = false;
  chooseVariation();
  updateProgress();
  resetBoard();
});

// ---------------------------------------------------------------------------
// Logique d'entraînement
// ---------------------------------------------------------------------------
function setStatus(text: string) {
  statusEl.textContent = text;
}

function updateProgress() {
  progressEl.textContent = `${streak}/${totalVariations}`;
}

function resetBoard() {
  moveNumber = 1;
  pos = Chess.default();
  lastMove = undefined;
  locked = false;
  awaitingNext = false;
  hintBtn.textContent = 'Show Move';
  syncBoard();
  // Si l'utilisateur joue les noirs, le « moteur » ouvre la partie
  if (userColor === 'black' && variation) setTimeout(engineTurn, 300);
}

/** Demande la pièce de promotion (dialogue simple). */
function askPromotion(): Promise<Role> {
  return new Promise((resolve) => {
    promoEl.hidden = false;
    const onClick = (e: Event) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-role]');
      if (!btn) return;
      promoEl.hidden = true;
      promoEl.removeEventListener('click', onClick);
      resolve(btn.dataset.role as Role);
    };
    promoEl.addEventListener('click', onClick);
  });
}

async function onUserMove(orig: Key, dest: Key) {
  if (!variation) {
    setStatus('⚠️ Load a PGN file first!');
    syncBoard();
    return;
  }

  const from = parseSquare(orig)!;
  const to = parseSquare(dest)!;
  let promotion: Role | undefined;
  if (
    pos.board.get(from)?.role === 'pawn' &&
    (squareRank(to) === 0 || squareRank(to) === 7)
  ) {
    promotion = await askPromotion();
  }

  const move: NormalMove = { from, to, promotion };
  if (!pos.isLegal(move)) {
    syncBoard();
    return;
  }

  const san = makeSan(pos, move); // ne modifie pas `pos`
  if (norm(san) === variation[moveNumber - 1]) {
    playSound(san.includes('x'));
    pos.play(move);
    lastMove = [orig, dest];
    moveNumber++;
    setStatus('✅ Correct move!');
    checkForCompletion();
    syncBoard();
    // On ne lance la réponse que si la ligne n'est pas terminée
    if (!locked) setTimeout(engineTurn, 200);
  } else {
    setStatus('❌ Wrong move!');
    mistakes++;
    mistakesEl.textContent = String(mistakes);
    syncBoard(); // remet la pièce à sa place
  }
}

/** Joue le coup attendu de la ligne (réponse de l'adversaire ou indice). */
function engineTurn() {
  if (!variation || locked) return;
  const san = variation[moveNumber - 1];
  if (san === undefined) return;

  const move: Move | undefined = parseSan(pos, san);
  if (!move) {
    setStatus(`⚠️ Unreadable move in PGN: ${san}`);
    return;
  }
  playSound(makeSan(pos, move).includes('x'));
  pos.play(move);
  lastMove = chessgroundMove(move);
  moveNumber++;
  checkForCompletion();
  syncBoard();
}

function showMove() {
  if (!variation) {
    setStatus('⚠️ Load a PGN file first!');
    return;
  }
  if (locked || pos.turn !== userColor) return;

  mistakes++;
  mistakesEl.textContent = String(mistakes);
  setStatus('');
  hintBtn.disabled = true;

  engineTurn(); // joue le coup attendu pour l'utilisateur
  setTimeout(engineTurn, 500); // puis la réponse de l'adversaire
  setTimeout(() => {
    if (!locked && variation) hintBtn.disabled = false;
  }, 1000);
}

function checkForCompletion() {
  if (!variation || moveNumber <= variation.length) return;

  streak++;
  locked = true;
  if (variations.length === 0) {
    setStatus('🎉 Training completed!');
    variation = null;
    hintBtn.disabled = true;
  } else {
    chooseVariation();
    setStatus('🎉 Line completed!');
    awaitingNext = true;
    hintBtn.textContent = 'Next variation';
    hintBtn.disabled = false;
  }
  updateProgress();
}

hintBtn.addEventListener('click', () => (awaitingNext ? resetBoard() : showMove()));
resetBtn.addEventListener('click', resetBoard);

syncBoard();