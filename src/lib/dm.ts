/** Stable DM room id for a pair of user ids (used in DB and Socket.io). */
export function dmRoomId(userIdA: string, userIdB: string): string {
  return userIdA < userIdB ? `dm:${userIdA}_${userIdB}` : `dm:${userIdB}_${userIdA}`;
}
