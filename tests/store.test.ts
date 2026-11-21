import { beforeAll, expect, test } from "bun:test";
import { isAllowed } from "../src/server/auth";
import { listSongs, migrate, saveSong } from "../src/server/db";
import {
  addPerformance,
  createDuo,
  createEvent,
  createGroup,
  currentInvite,
  dequeue,
  enqueue,
  eventHistory,
  eventState,
  findDuo,
  findInvite,
  groupHistory,
  groupRanking,
  isMember,
  join,
  listGroups,
  moveInQueue,
  removeDuo,
  setEventStatus,
  startSinging,
} from "../src/server/store";

/** Each test gets its own group, so they can share one database. */
async function setup(owner = `${crypto.randomUUID()}@example.com`) {
  const group = await createGroup("Bar do Zé", owner);
  const event = await createEvent(group.id, "Sexta");
  const songs = ["a", "b"].map((suffix) => `${group.id}-${suffix}`);
  for (const id of songs) {
    await saveSong({
      id,
      groupId: group.id,
      title: `Música ${id.slice(-1)}`,
      artist: "Artista",
      language: "pt",
      duration: 10,
      source: "local",
      lyricsSource: "lrc",
      mediaFile: "media.mp3",
      instrumentalFile: null,
      hasVideo: false,
      lines: [{ start: 1, end: 2, text: "lá" }],
      notes: [],
      melody: null,
    });
  }
  return { owner, group, event, songs: songs as [string, string] };
}

const queueOf = async (eventId: string) => (await eventState(eventId, true)).queue;
const perform = (eventId: string, songId: string, singer: string, score: number) =>
  addPerformance({ eventId, songId, singer, score, accuracy: score / 10000, difficulty: "normal" });

beforeAll(migrate);

test("groups belong to their members and list their events", async () => {
  const { owner, group, event } = await setup();
  const other = await setup();
  expect(await isMember(group.id, owner)).toBe(true);
  expect(await isMember(other.group.id, owner)).toBe(false);

  const later = await createEvent(group.id, "Sábado");
  const [listed] = await listGroups(owner);
  expect(await listGroups(owner)).toHaveLength(1);
  expect(listed!.events.map((item) => item.id).sort()).toEqual([event.id, later.id].sort());
  await expect(createGroup("  ", owner)).rejects.toThrow("nome do grupo");
});

test("a QR code registers exactly one duo and is then replaced", async () => {
  const { event } = await setup();
  const token = await currentInvite(event.id);
  expect(await currentInvite(event.id)).toBe(token);
  expect(await findInvite(token)).toEqual({ eventId: event.id, eventName: "Sexta" });

  const session = await join(token, [" Ana ", "Bia"]);
  expect(session).toMatchObject({ eventId: event.id, duo: { name: "Ana & Bia", members: ["Ana", "Bia"] } });
  expect(await findInvite(token)).toBeNull();
  await expect(join(token, ["Caio", "Davi"])).rejects.toThrow("já foi usado");
  expect(await currentInvite(event.id)).not.toBe(token);
  expect((await eventState(event.id, false)).duos).toHaveLength(1);
});

test("a rejected registration does not burn the code, and two phones cannot share one", async () => {
  const { event } = await setup();
  const token = await currentInvite(event.id);
  await expect(join(token, ["Ana", ""])).rejects.toThrow("duas pessoas");
  await expect(join(token, ["Ana", "x".repeat(25)])).rejects.toThrow("até 24");
  await expect(join("", ["Ana", "Bia"])).rejects.toThrow("já foi usado");
  expect(await findInvite(token)).not.toBeNull();

  const results = await Promise.allSettled([join(token, ["Ana", "Bia"]), join(token, ["Caio", "Davi"])]);
  expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
});

test("the queue keeps arrival order, rejects repeats and can be reordered", async () => {
  const { event, songs } = await setup();
  const ana = (await createDuo(event.id, ["Ana", "Bia"])).duo;
  const caio = (await createDuo(event.id, ["Caio", "Davi"])).duo;
  await enqueue(event.id, songs[0], ana.id);
  await enqueue(event.id, songs[0], caio.id);
  await enqueue(event.id, songs[1], ana.id);
  await expect(enqueue(event.id, songs[0], ana.id)).rejects.toThrow("já está na fila");
  await expect(enqueue(event.id, songs[0], "ghost")).rejects.toThrow("Dupla não encontrada");

  const [a, b, c] = await queueOf(event.id);
  const order = async () => (await queueOf(event.id)).map((item) => item.id);
  await moveInQueue(c!.id, -1);
  expect(await order()).toEqual([a!.id, c!.id, b!.id]);
  await moveInQueue(a!.id, -1); // already first
  await moveInQueue(b!.id, 1); // already last
  expect(await order()).toEqual([a!.id, c!.id, b!.id]);

  await startSinging(a!.id);
  await startSinging(c!.id);
  expect((await queueOf(event.id)).map((item) => item.singing)).toEqual([false, true, false]);

  await dequeue(c!.id);
  await removeDuo(caio.id);
  expect(await order()).toEqual([a!.id]);
  expect(await findDuo(caio.id)).toBeNull();
});

test("a group cannot queue another group's songs, but shared songs are open to all", async () => {
  const mine = await setup();
  const theirs = await setup();
  const duo = (await createDuo(mine.event.id, ["Ana", "Bia"])).duo;
  await expect(enqueue(mine.event.id, theirs.songs[0], duo.id)).rejects.toThrow("Música não encontrada");

  const shared = `shared-${mine.group.id}`;
  await saveSong({
    id: shared, groupId: null, title: "Compartilhada", artist: "Todos", language: null, duration: 5, source: "local",
    lyricsSource: "demo", mediaFile: "media.mp3", instrumentalFile: null, hasVideo: false, lines: [], notes: [], melody: null,
  });
  await enqueue(mine.event.id, shared, duo.id);
  const visible = (await listSongs(mine.group.id)).map((song) => song.id);
  expect(visible).toContain(shared);
  expect(visible).toContain(mine.songs[0]);
  expect(visible).not.toContain(theirs.songs[0]);
});

test("performances build the event history and the group's rankings", async () => {
  const { group, event, songs } = await setup();
  const second = await createEvent(group.id, "Sábado");
  await perform(event.id, songs[0], "Ana & Bia", 7000);
  await perform(event.id, songs[1], "Caio & Davi", 9000);
  await perform(second.id, songs[0], "Edu & Fábio", 8000);

  expect((await eventHistory(event.id)).map((entry) => entry.singer)).toEqual(["Ana & Bia", "Caio & Davi"]);
  expect((await groupHistory(group.id)).map((entry) => entry.eventName)).toEqual(["Sábado", "Sexta", "Sexta"]);
  expect((await groupRanking(group.id)).map((entry) => entry.score)).toEqual([9000, 8000, 7000]);
  expect((await groupRanking(group.id, songs[0])).map((entry) => entry.singer)).toEqual(["Edu & Fábio", "Ana & Bia"]);

  const [best] = (await listSongs(group.id)).filter((song) => song.id === songs[0]);
  expect(best).toMatchObject({ bestScore: 8000, bestPlayer: "Edu & Fábio" });
  expect((await listGroups((await setup()).owner))[0]!.events[0]!.performances).toBe(0);
});

test("closing an event freezes it but keeps its history", async () => {
  const { event, songs } = await setup();
  const duo = (await createDuo(event.id, ["Ana", "Bia"])).duo;
  await enqueue(event.id, songs[0], duo.id);
  await perform(event.id, songs[0], "Ana & Bia", 5000);
  const token = await currentInvite(event.id);

  await setEventStatus(event.id, "closed");
  expect(await queueOf(event.id)).toEqual([]);
  expect(await findInvite(token)).toBeNull();
  await expect(createDuo(event.id, ["Caio", "Davi"])).rejects.toThrow("encerrado");
  await expect(enqueue(event.id, songs[0], duo.id)).rejects.toThrow("encerrado");
  await expect(perform(event.id, songs[0], "Ana & Bia", 1)).rejects.toThrow("encerrado");
  expect(await eventHistory(event.id)).toHaveLength(1);

  await setEventStatus(event.id, "open");
  await enqueue(event.id, songs[0], duo.id);
  expect(await queueOf(event.id)).toHaveLength(1);
});

test("the allowlist limits who may have an account", () => {
  expect(isAllowed("anyone@example.com", [])).toBe(true);
  expect(isAllowed(" Ana@Example.com ", ["ana@example.com"])).toBe(true);
  expect(isAllowed("eve@example.com", ["ana@example.com"])).toBe(false);
});
