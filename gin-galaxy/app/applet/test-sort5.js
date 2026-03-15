const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const getRankIndex = (rank) => RANKS.indexOf(rank);

const hand = [
  { suit: "♠", rank: "2" },
  { suit: "♠", rank: "10" },
  { suit: "♠", rank: "J" },
  { suit: "♠", rank: "K" },
  { suit: "♠", rank: "5" }
];

const sortedHand = [...hand].sort((a, b) => {
  if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
  return getRankIndex(a.rank) - getRankIndex(b.rank);
});

console.log(sortedHand.map(c => c.rank + c.suit).join(" "));
