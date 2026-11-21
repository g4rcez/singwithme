import { beforeEach, expect, test } from "bun:test";
import {
  createDuo,
  currentInvite,
  dequeue,
  enqueue,
  isInviteValid,
  join,
  listDuos,
  listQueue,
  moveInQueue,
  ownsDuo,
  removeDuo,
  resetParty,
  startSinging,
} from "../src/server/party";

const song = (id: string) => ({ id, title: `Música ${id}`, artist: "Artista" });
const ORIGIN = "http://192.168.0.10:3210";

beforeEach(resetParty);

test("a QR code registers exactly one duo and is then replaced", () => {
  const first = currentInvite(ORIGIN);
  expect(first.url).toBe(`${ORIGIN}/#/join/${first.token}`);
  expect(currentInvite(ORIGIN).token).toBe(first.token);

  const session = join(first.token, [" Ana ", "Bia"]);
  expect(session.duo).toMatchObject({ name: "Ana & Bia", members: ["Ana", "Bia"] });
  expect(isInviteValid(first.token)).toBe(false);
  expect(() => join(first.token, ["Caio", "Davi"])).toThrow("já foi usado");

  const second = currentInvite(ORIGIN);
  expect(second.token).not.toBe(first.token);
  expect(listDuos()).toHaveLength(1);
});

test("a rejected registration does not burn the code", () => {
  const { token } = currentInvite(ORIGIN);
  expect(() => join(token, ["Ana", ""])).toThrow("duas pessoas");
  expect(() => join(token, ["Ana"])).toThrow("duas pessoas");
  expect(() => join(token, ["Ana", "x".repeat(25)])).toThrow("até 24");
  expect(isInviteValid(token)).toBe(true);
  expect(() => join("", ["Ana", "Bia"])).toThrow("já foi usado");
});

test("only the duo's own secret proves ownership", () => {
  const ana = createDuo(["Ana", "Bia"]);
  const caio = createDuo(["Caio", "Davi"]);
  expect(ownsDuo(ana.duo.id, ana.secret)).toBe(true);
  expect(ownsDuo(ana.duo.id, caio.secret)).toBe(false);
  expect(ownsDuo(ana.duo.id, null)).toBe(false);
  expect(ownsDuo("ghost", "")).toBe(false);
});

test("the queue keeps arrival order, rejects repeats and can be reordered", () => {
  const ana = createDuo(["Ana", "Bia"]).duo;
  const caio = createDuo(["Caio", "Davi"]).duo;
  const a = enqueue(song("1"), ana.id);
  const b = enqueue(song("1"), caio.id);
  const c = enqueue(song("2"), ana.id);
  expect(() => enqueue(song("1"), ana.id)).toThrow("já está na fila");
  expect(() => enqueue(song("1"), "ghost")).toThrow("Dupla não encontrada");

  const order = () => listQueue().map((item) => item.id);
  expect(order()).toEqual([a.id, b.id, c.id]);
  moveInQueue(c.id, -1);
  expect(order()).toEqual([a.id, c.id, b.id]);
  moveInQueue(a.id, -1); // already first: nothing happens
  moveInQueue(b.id, 1); // already last
  expect(order()).toEqual([a.id, c.id, b.id]);

  dequeue(c.id);
  expect(order()).toEqual([a.id, b.id]);
});

test("only one item is on stage at a time", () => {
  const ana = createDuo(["Ana", "Bia"]).duo;
  const a = enqueue(song("1"), ana.id);
  const b = enqueue(song("2"), ana.id);
  startSinging(a.id);
  startSinging(b.id);
  expect(listQueue().map((item) => item.singing)).toEqual([false, true]);
  expect(() => startSinging("ghost")).toThrow("não está mais na fila");
});

test("removing a duo removes its queue entries", () => {
  const ana = createDuo(["Ana", "Bia"]).duo;
  const caio = createDuo(["Caio", "Davi"]).duo;
  enqueue(song("1"), ana.id);
  enqueue(song("2"), caio.id);
  removeDuo(ana.id);
  expect(listDuos().map((duo) => duo.name)).toEqual(["Caio & Davi"]);
  expect(listQueue().map((item) => item.duoName)).toEqual(["Caio & Davi"]);
});
