export function reviewGateOpen(review: { lastAgentSeq: number; ackSeq: number }): boolean {
  return review.ackSeq >= review.lastAgentSeq;
}
