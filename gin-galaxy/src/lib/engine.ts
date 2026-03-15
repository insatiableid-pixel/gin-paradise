export type Suit = "♠" | "♥" | "♦" | "♣";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

export interface Card {
  suit: Suit;
  rank: Rank;
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  score: number;
}

export interface GameState {
  id: string;
  players: Player[];
  currentPlayerIndex: number;
  stock: Card[];
  discard: Card[];
  status: "waiting" | "playing" | "round_over" | "game_over";
  winnerId: string | null;
  roundWinnerId: string | null;
  roundPoints: number;
  message: string;
}

export const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
export const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export const getCardValue = (rank: Rank): number => {
  if (rank === "A") return 1;
  if (["J", "Q", "K"].includes(rank)) return 10;
  return parseInt(rank);
};

export const getRankIndex = (rank: Rank): number => {
  return RANKS.indexOf(rank);
};

export const SUIT_ORDER: Record<Suit, number> = { "♣": 0, "♦": 1, "♥": 2, "♠": 3 };

export const getSuitIndex = (suit: Suit): number => SUIT_ORDER[suit];

export const sortHand = (hand: Card[]): Card[] => {
  return [...hand].sort((a, b) => {
    const suitDiff = getSuitIndex(a.suit) - getSuitIndex(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return getRankIndex(a.rank) - getRankIndex(b.rank);
  });
};

export const createDeck = (): Card[] => {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
};

export const shuffleDeck = (deck: Card[]): Card[] => {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const randomBuffer = new Uint32Array(1);
    crypto.getRandomValues(randomBuffer);
    const j = randomBuffer[0] % (i + 1);
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
};

export interface HandEvaluation {
  melds: Card[][];
  deadwood: Card[];
  deadwoodValue: number;
}

export const findValidMelds = (cards: Card[]): Card[][] => {
  const melds: Card[][] = [];
  
  // Find Sets
  const rankGroups = new Map<Rank, Card[]>();
  for (const card of cards) {
    if (!rankGroups.has(card.rank)) rankGroups.set(card.rank, []);
    rankGroups.get(card.rank)!.push(card);
  }
  
  for (const group of rankGroups.values()) {
    if (group.length >= 3) {
      melds.push([group[0], group[1], group[2]]);
      if (group.length === 4) {
        melds.push([group[0], group[1], group[3]]);
        melds.push([group[0], group[2], group[3]]);
        melds.push([group[1], group[2], group[3]]);
        melds.push([...group]);
      }
    }
  }
  
  // Find Runs
  const suitGroups = new Map<Suit, Card[]>();
  for (const card of cards) {
    if (!suitGroups.has(card.suit)) suitGroups.set(card.suit, []);
    suitGroups.get(card.suit)!.push(card);
  }
  
  for (const group of suitGroups.values()) {
    if (group.length >= 3) {
      const sorted = [...group].sort((a, b) => getRankIndex(a.rank) - getRankIndex(b.rank));
      for (let i = 0; i < sorted.length - 2; i++) {
        for (let j = i + 2; j < sorted.length; j++) {
          const run = sorted.slice(i, j + 1);
          let isValidRun = true;
          for (let k = 1; k < run.length; k++) {
            if (getRankIndex(run[k].rank) !== getRankIndex(run[k - 1].rank) + 1) {
              isValidRun = false;
              break;
            }
          }
          if (isValidRun) {
            melds.push(run);
          }
        }
      }
    }
  }
  
  return melds;
};

export const evaluateHand = (cards: Card[]): HandEvaluation => {
  const allMelds = findValidMelds(cards);
  
  let bestEval: HandEvaluation = {
    melds: [],
    deadwood: cards,
    deadwoodValue: cards.reduce((sum, c) => sum + getCardValue(c.rank), 0)
  };

  const search = (meldIndex: number, currentMelds: Card[][], usedCards: Set<string>) => {
    const currentDeadwood = cards.filter(c => !usedCards.has(`${c.rank}${c.suit}`));
    const currentDeadwoodValue = currentDeadwood.reduce((sum, c) => sum + getCardValue(c.rank), 0);
    
    if (currentDeadwoodValue < bestEval.deadwoodValue) {
      bestEval = {
        melds: [...currentMelds],
        deadwood: currentDeadwood,
        deadwoodValue: currentDeadwoodValue
      };
    }

    for (let i = meldIndex; i < allMelds.length; i++) {
      const meld = allMelds[i];
      const hasOverlap = meld.some(c => usedCards.has(`${c.rank}${c.suit}`));
      if (!hasOverlap) {
        const newUsed = new Set(usedCards);
        meld.forEach(c => newUsed.add(`${c.rank}${c.suit}`));
        search(i + 1, [...currentMelds, meld], newUsed);
      }
    }
  };

  search(0, [], new Set());
  return bestEval;
};

export const canLayOff = (card: Card, meld: Card[]): boolean => {
  if (meld.length === 0) return false;
  
  const isSet = meld.every(c => c.rank === meld[0].rank);
  if (isSet) {
    return meld.length < 4 && card.rank === meld[0].rank;
  }
  
  const isRun = meld.every(c => c.suit === meld[0].suit);
  if (isRun) {
    if (card.suit !== meld[0].suit) return false;
    const sortedMeld = [...meld].sort((a, b) => getRankIndex(a.rank) - getRankIndex(b.rank));
    const cardIndex = getRankIndex(card.rank);
    const minIndex = getRankIndex(sortedMeld[0].rank);
    const maxIndex = getRankIndex(sortedMeld[sortedMeld.length - 1].rank);
    return cardIndex === minIndex - 1 || cardIndex === maxIndex + 1;
  }
  
  return false;
};

export const layOff = (knockerMelds: Card[][], opponentDeadwood: Card[]): Card[] => {
  let currentDeadwood = [...opponentDeadwood];
  let laidOff = true;
  const activeMelds = knockerMelds.map(m => [...m]);

  while (laidOff) {
    laidOff = false;
    for (let i = currentDeadwood.length - 1; i >= 0; i--) {
      const card = currentDeadwood[i];
      for (const meld of activeMelds) {
        if (canLayOff(card, meld)) {
          meld.push(card);
          currentDeadwood.splice(i, 1);
          laidOff = true;
          break;
        }
      }
    }
  }
  
  return currentDeadwood;
};

export const evaluateAndLayOff = (opponentHand: Card[], knockerMelds: Card[][]): HandEvaluation => {
  const allMelds = findValidMelds(opponentHand);
  
  let bestEval: HandEvaluation = {
    melds: [],
    deadwood: opponentHand,
    deadwoodValue: opponentHand.reduce((sum, c) => sum + getCardValue(c.rank), 0)
  };

  const search = (meldIndex: number, currentMelds: Card[][], usedCards: Set<string>) => {
    const currentDeadwood = opponentHand.filter(c => !usedCards.has(`${c.rank}${c.suit}`));
    const finalDeadwood = layOff(knockerMelds, currentDeadwood);
    const currentDeadwoodValue = finalDeadwood.reduce((sum, c) => sum + getCardValue(c.rank), 0);
    
    if (currentDeadwoodValue < bestEval.deadwoodValue) {
      bestEval = {
        melds: [...currentMelds],
        deadwood: finalDeadwood,
        deadwoodValue: currentDeadwoodValue
      };
    }

    for (let i = meldIndex; i < allMelds.length; i++) {
      const meld = allMelds[i];
      const hasOverlap = meld.some(c => usedCards.has(`${c.rank}${c.suit}`));
      if (!hasOverlap) {
        const newUsed = new Set(usedCards);
        meld.forEach(c => newUsed.add(`${c.rank}${c.suit}`));
        search(i + 1, [...currentMelds, meld], newUsed);
      }
    }
  };

  search(0, [], new Set());
  return bestEval;
};

export const calculateDeadwood = (hand: Card[]): number => {
  return evaluateHand(hand).deadwoodValue;
};

export const createGame = (player1: Omit<Player, "hand" | "score">, player2: Omit<Player, "hand" | "score">): GameState => {
  let deck = shuffleDeck(createDeck());
  
  const p1Hand = deck.splice(0, 10);
  const p2Hand = deck.splice(0, 10);
  const discard = [deck.pop()!];

  return {
    id: crypto.randomUUID(),
    players: [
      { ...player1, hand: p1Hand, score: 0 },
      { ...player2, hand: p2Hand, score: 0 }
    ],
    currentPlayerIndex: 0,
    stock: deck,
    discard,
    status: "playing",
    winnerId: null,
    roundWinnerId: null,
    roundPoints: 0,
    message: "Game started."
  };
};

export const drawCard = (state: GameState, playerId: string, source: "stock" | "discard"): GameState => {
  if (state.status !== "playing") return state;
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex !== state.currentPlayerIndex) return state; // Not their turn
  
  const player = state.players[playerIndex];
  if (player.hand.length > 10) return state; // Already drew

  const newState = { ...state, players: [...state.players] };
  const newPlayer = { ...player, hand: [...player.hand] };

  if (source === "stock") {
    if (newState.stock.length === 0) {
      // Reshuffle discard into stock if empty (except top card)
      const topDiscard = newState.discard.pop()!;
      newState.stock = shuffleDeck(newState.discard);
      newState.discard = [topDiscard];
    }
    newPlayer.hand.push(newState.stock.pop()!);
  } else {
    if (newState.discard.length === 0) return state;
    newPlayer.hand.push(newState.discard.pop()!);
  }

  newState.players[playerIndex] = newPlayer;
  newState.message = `${player.name} drew from ${source}.`;
  return newState;
};

export const discardCard = (state: GameState, playerId: string, cardIndex: number): GameState => {
  if (state.status !== "playing") return state;
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex !== state.currentPlayerIndex) return state;
  
  const player = state.players[playerIndex];
  if (player.hand.length <= 10) return state; // Must draw first

  const newState = { ...state, players: [...state.players] };
  const newPlayer = { ...player, hand: [...player.hand] };

  const [discardedCard] = newPlayer.hand.splice(cardIndex, 1);
  newState.discard.push(discardedCard);

  newState.players[playerIndex] = newPlayer;
  newState.currentPlayerIndex = (state.currentPlayerIndex + 1) % 2;
  newState.message = `${player.name} discarded ${discardedCard.rank}${discardedCard.suit}.`;

  return newState;
};

export const knock = (state: GameState, playerId: string, cardIndex: number): GameState => {
  if (state.status !== "playing") return state;
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex !== state.currentPlayerIndex) return state;

  const player = state.players[playerIndex];
  if (player.hand.length <= 10) return state;

  const opponentIndex = (playerIndex + 1) % 2;
  const opponent = state.players[opponentIndex];

  // Discard the card
  const newHand = [...player.hand];
  const [discardedCard] = newHand.splice(cardIndex, 1);
  
  const knockerEval = evaluateHand(newHand);
  const knockerDeadwood = knockerEval.deadwoodValue;
  
  if (knockerDeadwood > 10) {
    // Invalid knock
    return { ...state, message: "Cannot knock with more than 10 deadwood." };
  }

  let opponentDeadwood = 0;
  if (knockerDeadwood === 0) {
    // Gin: no lay-offs allowed
    opponentDeadwood = evaluateHand(opponent.hand).deadwoodValue;
  } else {
    // Normal knock: opponent can lay off
    opponentDeadwood = evaluateAndLayOff(opponent.hand, knockerEval.melds).deadwoodValue;
  }

  let roundPoints = 0;
  let roundWinnerId = null;
  let message = "";

  if (knockerDeadwood === 0) {
    // Gin
    roundPoints = opponentDeadwood + 25;
    roundWinnerId = player.id;
    message = `${player.name} goes Gin! Wins ${roundPoints} points.`;
  } else if (opponentDeadwood <= knockerDeadwood) {
    // Undercut
    roundPoints = (knockerDeadwood - opponentDeadwood) + 25;
    roundWinnerId = opponent.id;
    message = `${opponent.name} undercuts! Wins ${roundPoints} points.`;
  } else {
    // Normal knock win
    roundPoints = opponentDeadwood - knockerDeadwood;
    roundWinnerId = player.id;
    message = `${player.name} knocks. Wins ${roundPoints} points.`;
  }

  const newState = { ...state, players: [...state.players] };
  
  const winnerIndex = newState.players.findIndex(p => p.id === roundWinnerId);
  newState.players[winnerIndex].score += roundPoints;

  newState.status = "round_over";
  newState.roundWinnerId = roundWinnerId;
  newState.roundPoints = roundPoints;
  newState.message = message;

  if (newState.players[winnerIndex].score >= 100) {
    newState.status = "game_over";
    newState.winnerId = roundWinnerId;
    newState.message += ` ${newState.players[winnerIndex].name} wins the game!`;
  }

  return newState;
};

export const nextRound = (state: GameState): GameState => {
  if (state.status !== "round_over") return state;

  let deck = shuffleDeck(createDeck());
  const p1Hand = deck.splice(0, 10);
  const p2Hand = deck.splice(0, 10);
  const discard = [deck.pop()!];

  return {
    ...state,
    players: [
      { ...state.players[0], hand: p1Hand },
      { ...state.players[1], hand: p2Hand }
    ],
    stock: deck,
    discard,
    status: "playing",
    roundWinnerId: null,
    roundPoints: 0,
    message: "New round started."
  };
};
