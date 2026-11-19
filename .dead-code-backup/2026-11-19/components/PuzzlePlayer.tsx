"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import { UserPuzzle, MoveValidation, HintResult, PuzzleAttempt } from "@/types";
import { SM2State, createInitialWrongPuzzleState, calculateNextState } from "@/lib/sm2";

interface PuzzlePlayerProps {
  puzzle: UserPuzzle;
  userRating: number;
  onComplete: (attempt: PuzzleAttempt) => void;
  onHint: () => HintResult;
  onSolution: () => string[]; // Returns full solution moves
  onClose: () => void;
}

const PIECE_NAMES: Record<string, string> = {
  p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King",
  P: "Pawn", N: "Knight", B: "Bishop", R: "Rook", Q: "Queen", K: "King",
};

const SQUARE_SIZE = 50;

export function PuzzlePlayer({
  puzzle,
  userRating,
  onComplete,
  onHint,
  onSolution,
  onClose,
}: PuzzlePlayerProps) {
  // Parse puzzle moves (UCI format: "e2e4 e7e5 g1f3")
  const solutionMoves = puzzle.moves.split(" ").filter(Boolean);
  
  // Chess.js instance for validation
  const chessRef = useRef(new Chess(puzzle.fen));
  const [chess] = useState(() => new Chess(puzzle.fen));
  
  // Game state
  const [currentMoveIndex, setCurrentMoveIndex] = useState(0);
  const [userMoves, setUserMoves] = useState<string[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [hintUsed, setHintUsed] = useState(false);
  const [solutionViewed, setSolutionViewed] = useState(false);
  const [startTime] = useState(Date.now());
  const [lastMoveValidation, setLastMoveValidation] = useState<MoveValidation | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  
  // Determine orientation from FEN
  useEffect(() => {
    const fenParts = puzzle.fen.split(" ");
    const activeColor = fenParts[1];
    setOrientation(activeColor === 'w' ? 'white' : 'black');
  }, [puzzle.fen]);

  // Reset chess.js when puzzle changes
  useEffect(() => {
    chessRef.current = new Chess(puzzle.fen);
    setCurrentMoveIndex(0);
    setUserMoves([]);
    setIsComplete(false);
    setIsCorrect(null);
    setHintUsed(false);
    setSolutionViewed(false);
    setShowSolution(false);
    setLastMoveValidation(null);
  }, [puzzle.id, puzzle.fen, puzzle.moves]);

  // Validate a user move
  const validateMove = useCallback((from: string, to: string, promotion?: string): MoveValidation => {
    const chess = chessRef.current;
    const move = chess.move({ from, to, promotion });
    
    if (!move) {
      // Illegal move
      return {
        isCorrect: false,
        isLegal: false,
        expectedMove: solutionMoves[currentMoveIndex] || "",
        expectedSan: "",
        explanation: "Illegal move",
      };
    }

    // Check if it matches the expected solution move
    const expectedUci = solutionMoves[currentMoveIndex];
    const isCorrect = move.from + move.to + (move.promotion || "") === expectedUci;
    
    const validation: MoveValidation = {
      isCorrect,
      isLegal: true,
      expectedMove: expectedUci,
      expectedSan: move.san,
      explanation: isCorrect ? undefined : `Expected ${expectedUci}`,
    };

    setLastMoveValidation(validation);
    return validation;
  }, [currentMoveIndex, solutionMoves]);

  // Handle square click from react-chessboard
  const handleSquareClick = useCallback((square: string) => {
    if (isComplete) return;
    
    const selectedSquare = (window as any).__selectedSquare;
    
    if (!selectedSquare) {
      // First click - select piece
      const piece = chessRef.current.get(square as any);
      if (piece && piece.color === (orientation === 'white' ? 'w' : 'b')) {
        (window as any).__selectedSquare = square;
      }
    } else {
      // Second click - attempt move
      const from = selectedSquare;
      const to = square;
      
      // Check for promotion
      const piece = chessRef.current.get(from);
      let promotion: string | undefined;
      if (piece?.type === 'p' && (to[1] === '8' || to[1] === '1')) {
        promotion = 'q'; // Auto-promote to queen for simplicity
      }
      
      const validation = validateMove(from, to, promotion);
      
      if (!validation.isLegal) {
        // Illegal move - keep selection
        (window as any).__selectedSquare = square;
        return;
      }
      
      // Legal move made
      (window as any).__selectedSquare = null;
      setUserMoves(prev => [...prev, from + to + (promotion || "")]);
      
      if (validation.isCorrect) {
        // Correct move
        setCurrentMoveIndex(prev => prev + 1);
        
        // Check if puzzle complete
        if (currentMoveIndex + 1 >= solutionMoves.length) {
          // Puzzle solved!
          setIsComplete(true);
          setIsCorrect(true);
          
          const attempt: PuzzleAttempt = {
            puzzleId: puzzle.id,
            userId: "", // Filled by parent
            result: 'correct',
            userMove: from + to + (promotion || ""),
            expectedMove: validation.expectedMove,
            moveNumber: currentMoveIndex,
            timeSpent: Date.now() - startTime,
            hintUsed,
            solutionViewed,
            ratingBefore: userRating,
            ratingAfter: userRating + 10,
            timestamp: new Date(),
          };
          
          // Small delay to show final position
          setTimeout(() => onComplete(attempt), 500);
        }
      } else {
        // Wrong move - puzzle failed
        setIsComplete(true);
        setIsCorrect(false);
        
        const attempt: PuzzleAttempt = {
          puzzleId: puzzle.id,
          userId: "",
          result: 'incorrect',
          userMove: from + to + (promotion || ""),
          expectedMove: validation.expectedMove,
          moveNumber: currentMoveIndex,
          timeSpent: Date.now() - startTime,
          hintUsed,
          solutionViewed,
          ratingBefore: userRating,
          ratingAfter: userRating - 10,
          timestamp: new Date(),
        };
        
        setTimeout(() => onComplete(attempt), 500);
      }
    }
  }, [isComplete, orientation, currentMoveIndex, solutionMoves, userRating, hintUsed, solutionViewed, startTime, validateMove, onComplete]);

  // Handle hint
  const handleHint = useCallback(() => {
    if (isComplete || hintUsed) return;
    
    setHintUsed(true);
    const hint = onHint();
    
    // Highlight the hint piece/square
    (window as any).__hintSquare = hint.square;
    setTimeout(() => {
      (window as any).__hintSquare = null;
    }, 3000);
  }, [isComplete, hintUsed, onHint]);

  // Handle show solution
  const handleSolution = useCallback(() => {
    if (isComplete) return;
    
    setSolutionViewed(true);
    setShowSolution(true);
    const solution = onSolution();
    console.log("Solution:", solution);
  }, [isComplete, onSolution]);

  // Custom board render with hints
  const customSquare = useCallback((props: any) => {
    const { square, children, style, ...rest } = props;
    const isHint = (window as any).__hintSquare === square;
    const isSelected = (window as any).__selectedSquare === square;
    const isLastMove = userMoves.length > 0 && 
      (userMoves[userMoves.length - 1].slice(0, 2) === square || 
       userMoves[userMoves.length - 1].slice(2, 4) === square);
    
    return (
      <div
        {...rest}
        className={`square ${square} ${isHint ? 'hint' : ''} ${isSelected ? 'selected' : ''} ${isLastMove ? 'last-move' : ''}`}
        style={{
          ...style,
          width: SQUARE_SIZE,
          height: SQUARE_SIZE,
          position: 'relative',
          backgroundColor: isHint ? '#fff3cd' : isSelected ? '#cce5ff' : undefined,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </div>
    );
  }, [userMoves]);

  // Get current FEN for board display
  const currentFen = chessRef.current.fen();

  return (
    <div className="puzzle-player p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Puzzle #{puzzle.id}</h2>
          <div className="flex items-center gap-4 text-sm text-gray-600 mt-1">
            <span>Rating: <span className="font-mono">{puzzle.rating}</span></span>
            <span>Themes: {puzzle.themes.join(", ")}</span>
            <span>Streak: {userRating - 1000 > 0 ? '+' : ''}{userRating - 1000}</span>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
      </div>

      {/* Board */}
      <div className="flex justify-center">
        <Chessboard
          position={currentFen}
          boardOrientation={orientation}
          boardWidth={SQUARE_SIZE * 8}
          customSquare={customSquare}
          onSquareClick={handleSquareClick}
          arePiecesDraggable={true}
          onPieceDrop={(sourceSquare, targetSquare, piece) => {
            if (isComplete) return false;
            
            let promotion: string | undefined;
            if (piece && piece[1] === 'P' && (targetSquare[1] === '8' || targetSquare[1] === '1')) {
              promotion = 'q';
            }
            
            const validation = validateMove(sourceSquare, targetSquare, promotion);
            
            if (!validation.isLegal) {
              return false; // Snap back
            }
            
            // Handle the move programmatically since we're using drag
            (window as any).__selectedSquare = null;
            setUserMoves(prev => [...prev, sourceSquare + targetSquare + (promotion || "")]);
            
            if (validation.isCorrect) {
              setCurrentMoveIndex(prev => prev + 1);
              
              if (currentMoveIndex + 1 >= solutionMoves.length) {
                setIsComplete(true);
                setIsCorrect(true);
                
                const attempt: PuzzleAttempt = {
                  puzzleId: puzzle.id,
                  userId: "",
                  result: 'correct',
                  userMove: sourceSquare + targetSquare + (promotion || ""),
                  expectedMove: validation.expectedMove,
                  moveNumber: currentMoveIndex,
                  timeSpent: Date.now() - startTime,
                  hintUsed,
                  solutionViewed,
                  ratingBefore: userRating,
                  ratingAfter: userRating + 10,
                  timestamp: new Date(),
                };
                
                setTimeout(() => onComplete(attempt), 500);
              }
            } else {
              setIsComplete(true);
              setIsCorrect(false);
              
              const attempt: PuzzleAttempt = {
                puzzleId: puzzle.id,
                userId: "",
                result: 'incorrect',
                userMove: sourceSquare + targetSquare + (promotion || ""),
                expectedMove: validation.expectedMove,
                moveNumber: currentMoveIndex,
                timeSpent: Date.now() - startTime,
                hintUsed,
                solutionViewed,
                ratingBefore: userRating,
                ratingAfter: userRating - 10,
                timestamp: new Date(),
              };
              
              setTimeout(() => onComplete(attempt), 500);
            }
            
            return true;
          }}
        />
      </div>

      {/* Move list / Progress */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {solutionMoves.map((move, i) => (
            <span
              key={move}
              className={`px-2 py-1 rounded text-xs font-mono ${
                i < currentMoveIndex ? 'bg-green-100 text-green-800' :
                i === currentMoveIndex ? 'bg-blue-100 text-blue-800' :
                'bg-gray-100 text-gray-500'
              }`}
            >
              {move}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span>Move {currentMoveIndex + 1} / {solutionMoves.length}</span>
        </div>
      </div>

      {/* Feedback */}
      {lastMoveValidation && !isComplete && (
        <div className={`p-3 rounded ${lastMoveValidation.isCorrect ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {lastMoveValidation.isCorrect ? (
            "Correct! "
          ) : (
            `Wrong. Expected: ${lastMoveValidation.expectedSan} (${lastMoveValidation.expectedMove})`
          )}
        </div>
      )}

      {/* Completion state */}
      {isComplete && (
        <div className={`p-4 rounded-lg text-center ${isCorrect ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <h3 className="text-xl font-bold mb-2">
            {isCorrect ? "🎉 Correct!" : "❌ Incorrect"}
          </h3>
          <p className="mb-4">
            {isCorrect 
              ? `Rating: ${userRating} → ${userRating + 10} (+10)`
              : `Rating: ${userRating} → ${userRating - 10} (-10)`
            }
          </p>
          {!isCorrect && (
            <button
              onClick={() => setShowSolution(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              Show Solution
            </button>
          )}
        </div>
      )}

      {/* Action buttons */}
      {!isComplete && (
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={handleHint}
            disabled={hintUsed}
            className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {hintUsed ? "Hint Used (-5)" : "Hint (-5)"}
          </button>
          <button
            onClick={handleSolution}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Show Solution
          </button>
        </div>
      )}

      {/* Solution modal */}
      {showSolution && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-bold mb-4">Solution</h3>
            <div className="flex flex-wrap gap-2 mb-4">
              {solutionMoves.map((move, i) => (
                <span
                  key={move}
                  className={`px-2 py-1 rounded text-xs font-mono ${
                    i < currentMoveIndex ? 'bg-green-100' :
                    i === currentMoveIndex ? 'bg-blue-100' :
                    'bg-gray-100'
                  }`}
                >
                  {i + 1}. {move}
                </span>
              ))}
            </div>
            <button
              onClick={() => setShowSolution(false)}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Close
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .square {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .square.hint {
          box-shadow: inset 0 0 0 3px #ffc107;
        }
        .square.selected {
          box-shadow: inset 0 0 0 3px #0d6efd;
        }
        .square.last-move {
          box-shadow: inset 0 0 0 2px #198754;
        }
      `}</style>
    </div>
  );
}