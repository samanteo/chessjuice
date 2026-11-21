"use client";

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef, useState } from "react";
import { Chessground } from "@lichess-org/chessground";

// Local type definitions based on @lichess-org/chessground types
type Color = "white" | "black";
type Role = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";
type Key = "a0" | `${File}${Rank}`;
type File = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
type Rank = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";
type FEN = string;
type CgColor = Color;

interface Piece {
  role: Role;
  color: Color;
  promoted?: boolean;
}

interface MoveMetadata {
  premove: boolean;
  ctrlKey?: boolean;
  holdTime?: number;
  captured?: Piece;
  predrop?: boolean;
}

type Dests = Map<Key, Key[]>;

type ChessgroundApi = ReturnType<typeof Chessground>;
type CgConfig = NonNullable<Parameters<typeof Chessground>[1]>;

interface ChessgroundWrapperProps {
  fen: string;
  orientation?: CgColor;
  lastMove?: Key[];
  check?: CgColor | boolean;
  premove?: Key[];
  dests?: Dests;
  pieceSet?: string;
  boardTheme?: string;
  coordinates?: boolean;
  onMove?: (orig: Key, dest: Key, capturedPiece?: Piece) => void;
  onPremove?: (orig: Key, dest: Key) => void;
  viewOnly?: boolean;
  className?: string;
  /* --- Appearance / behaviour toggles (all optional, backwards compatible) --- */
  animation?: boolean;
  pieceAnimation?: boolean;
  highlightLastMove?: boolean;
  highlightCheck?: boolean;
  autoCastle?: boolean;
  autoPromoteToQueen?: boolean;
  blockTouchScroll?: boolean;
  /**
   * The "guiding dots": legal-move destination markers drawn when a piece is
   * picked up (chessground's movable/premovable showDests). Default true —
   * switching it off leaves the board completely bare.
   */
  showDests?: boolean;
}

export const ChessgroundWrapper = forwardRef<any, ChessgroundWrapperProps>(
  (
    {
      fen,
      orientation = "white",
      lastMove,
      check,
      premove,
      dests,
      pieceSet = "mpchess",
      boardTheme = "green",
      coordinates = true,
      onMove,
      onPremove,
      viewOnly = false,
      className = "",
      animation = true,
      pieceAnimation = true,
      highlightLastMove = true,
      highlightCheck = true,
      autoCastle = true,
      autoPromoteToQueen = true,
      blockTouchScroll = false,
      showDests = true,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const groundRef = useRef<ReturnType<typeof Chessground> | null>(null);
    const configRef = useRef<CgConfig>({});
    const appliedClsRef = useRef<string[]>([]);
    // Last value of `showDests` we pushed to the board, so we can tell a real
    // flip from any other config update.
    const prevDestsRef = useRef(showDests);
    const [, forceRerender] = useState(0);

    // Build config
    const buildConfig = useCallback((): CgConfig => {
      // Both master "animations" and "piece animations" gate chessground movement.
      const animationEnabled = !!animation && !!pieceAnimation;
      // Respect the appearance toggles: only forward lastMove / check when enabled.
      const showLastMove = highlightLastMove ? lastMove : undefined;
      const showCheck = highlightCheck ? check : undefined;
      // The side to move MUST come from the FEN (field 2), NOT the board
      // orientation. Keying it off `orientation` made chessground believe it was
      // always the solver's turn even when the position said otherwise.
      const sideToMove: Color = fen.split(" ")[1] === "b" ? "black" : "white";

      return {
        fen,
        orientation,
        turnColor: sideToMove,
        lastMove: showLastMove,
        check: showCheck,
        coordinates,
        coordinatesOnSquares: false,
        viewOnly,
        addPieceZIndex: true,
        blockTouchScroll,
        highlight: {
          lastMove: !!showLastMove,
          check: !!showCheck,
        },
        animation: {
          enabled: animationEnabled,
          duration: 200,
        },
        movable: {
          // Constrain by the ACTUAL side to move (from the FEN), never the
          // orientation. `dests` already restricts legality.
          color: viewOnly ? undefined : sideToMove,
          // `free` defaults to TRUE in chessground (board-editor mode), which
          // makes canMove() ignore `dests` entirely — that is what let a knight
          // jump to an illegal square. Must be explicitly disabled.
          free: false,
          dests: dests ?? new Map(),
          // The "guiding dots" — legal-move markers. Toggled from the board head.
          showDests,
          events: {
            after: (orig: Key, dest: Key, metadata: MoveMetadata) => {
              if (onMove && !metadata.premove && !metadata.predrop) {
                onMove(orig, dest, metadata.captured);
              }
              if (onPremove && metadata.premove) {
                onPremove(orig, dest);
              }
            },
          },
        },
        premovable: {
          // PREMOVES MUST BE OFF: premove mode lets a piece be dragged to any
          // square with NO legality check (chessground's `canPremove` path in
          // userMove), so a knight could "jump" to an illegal square. Premoves
          // are meaningless in a puzzle trainer.
          enabled: false,
          showDests,
          castle: autoCastle,
          events: {
            set: (orig: Key, dest: Key) => {
              if (onPremove) onPremove(orig, dest);
            },
          },
        },
        draggable: {
          enabled: true,
          distance: 4,
          showGhost: true,
          deleteOnDropOff: false,
        },
        selectable: {
          enabled: true,
        },
        drawable: {
          enabled: false,
          visible: true,
          defaultSnapToValidMove: true,
          eraseOnMovablePieceClick: true,
        },
        events: {
          change: () => {},
          move: () => {},
          select: () => {},
          insert: (elements) => {
            // Preserve the classes chessground already added (orientation-*, manipulable)
            // and layer the board theme / piece set on top.
            if (elements.wrap) {
              elements.wrap.classList.add("cg-wrap");
              if (pieceSet) elements.wrap.classList.add(pieceSet);
              if (boardTheme) elements.wrap.classList.add(boardTheme);
            }
          },
        },
      };
    }, [
      fen,
      orientation,
      lastMove,
      check,
      coordinates,
      viewOnly,
      dests,
      pieceSet,
      boardTheme,
      onMove,
      onPremove,
      animation,
      pieceAnimation,
      highlightLastMove,
      highlightCheck,
      autoCastle,
      autoPromoteToQueen,
      blockTouchScroll,
      showDests,
    ]);

    // Keep the latest config available to the (stable) init effect.
    useEffect(() => {
      configRef.current = buildConfig();
    }, [buildConfig]);

    // Initialise chessground ONCE per viewOnly change (viewOnly cannot be
    // changed through `.set()`), applying everything else via `set()` below so
    // pieces/board are not torn down and rebuilt on every move.
    useEffect(() => {
      if (!containerRef.current) return;
      const ground = Chessground(containerRef.current, configRef.current);
      groundRef.current = ground;
      forceRerender((n) => n + 1);
      return () => {
        ground.destroy();
        groundRef.current = null;
      };
    }, [viewOnly]);

    // Apply config updates without recreating the board.
    useEffect(() => {
      if (groundRef.current) {
        groundRef.current.set(buildConfig());
        // OBSERVED, not assumed: flipping `showDests` through `set()` left the
        // already-painted `move-dest` squares on the board (the classes survive
        // because set() takes the animation path — our config always carries a
        // fen — and the square-class pass is skipped when nothing has moved).
        // The DOTS switch therefore appeared to do nothing until the next move.
        // A full redraw when the flag actually changes makes it take effect now.
        if (prevDestsRef.current !== showDests) {
          prevDestsRef.current = showDests;
          groundRef.current.redrawAll();
        }
      }
      // Reflect the resolved options on the wrap element (handy for styling/tests).
      const el = containerRef.current;
      if (el) {
        el.dataset.pieceSet = pieceSet;
        el.dataset.boardTheme = boardTheme;
        el.dataset.anim = String(!!animation && !!pieceAnimation);
        el.dataset.castle = String(!!autoCastle);
        el.dataset.touchScroll = String(!!blockTouchScroll);
        el.dataset.hlLast = String(!!highlightLastMove);
        el.dataset.hlCheck = String(!!highlightCheck);
        el.dataset.autoQueen = String(!!autoPromoteToQueen);
        el.dataset.dests = String(!!showDests);
      }
    }, [buildConfig, pieceSet, boardTheme, animation, pieceAnimation, highlightLastMove, highlightCheck, autoCastle, autoPromoteToQueen, blockTouchScroll, showDests]);

    // Keep the piece-set / board-theme classes in sync when they change live.
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      appliedClsRef.current.forEach((c) => el.classList.remove(c));
      const next = [pieceSet, boardTheme].filter(Boolean) as string[];
      next.forEach((c) => el.classList.add(c));
      appliedClsRef.current = next;
    }, [pieceSet, boardTheme]);

    // --- Fit the board to the available space ---
    // Wide viewports: a square that fits BOTH ways, so it never overflows a panel
    // (min(availW, availH)).
    //
    // Phones: fit the WIDTH only. A phone's usable viewport is ~660-700px once
    // Safari's address and tab bars are subtracted, which is far shorter than it
    // is wide-looking, so fitting the height collapsed the square to ~55% of the
    // screen width and left big dead margins either side — the user's "board still
    // small, need it to touch the borders of the phone". Filling the width makes
    // the board as big as the screen allows; the panel grows to match and the page
    // scrolls instead of squashing the board. See cdp-diag-board-width.mjs.
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const target = el.parentElement ?? el;

      const measure = () => {
        const cs = getComputedStyle(target);
        const rect = target.getBoundingClientRect();
        const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        const availW = rect.width - padX;
        const availH = rect.height - padY;
        const widthDriven = window.matchMedia("(max-width: 899px)").matches;
        const size = Math.max(200, Math.floor(widthDriven ? availW : Math.min(availW, availH)));
        el.style.width = size + "px";
        el.style.height = size + "px";
      };

      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(target);
      window.addEventListener("resize", measure);
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", measure);
      };
    }, []);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      getFen: () => groundRef.current?.getFen() ?? "",
      setFen: (newFen: FEN) => groundRef.current?.set({ fen: newFen }),
      setOrientation: (color: Color) => groundRef.current?.set({ orientation: color, turnColor: color }),
      toggleOrientation: () => groundRef.current?.toggleOrientation(),
      move: (orig: Key, dest: Key) => groundRef.current?.move(orig, dest),
      stop: () => groundRef.current?.stop(),
      setShapes: (shapes: any[]) => groundRef.current?.setShapes(shapes),
      setAutoShapes: (shapes: any[]) => groundRef.current?.setAutoShapes(shapes),
      destroy: () => groundRef.current?.destroy(),
    }));

    return (
      <div
        ref={containerRef}
        className={`chessground-wrapper cg-wrap ${className}`}
      />
    );
  }
);

ChessgroundWrapper.displayName = "ChessgroundWrapper";

export type { ChessgroundWrapperProps };
export default ChessgroundWrapper;
