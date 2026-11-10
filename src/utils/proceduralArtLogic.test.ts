import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FUTILE_DEVICES_TRACK,
  LETTER_CHAPTERS,
  computeNarrativeState,
  createSeededRandom,
  extractYouTubeId,
  getCloverCharmPoint,
  getHeartPoint,
  sampleBraceletToHeartPoints,
  sampleCloverToHeartPoints,
  slicePointsByDrawProgress,
} from './proceduralArtLogic';

test('deterministic PRNG produces repeatable sequence in [0, 1)', () => {
  const rng1 = createSeededRandom(1511);
  const rng2 = createSeededRandom(1511);
  for (let i = 0; i < 10; i++) {
    const v1 = rng1();
    const v2 = rng2();
    assert.equal(v1, v2);
    assert.ok(v1 >= 0 && v1 < 1);
  }
});

test('LETTER_CHAPTERS uses raw, sincere text with amorcitos, 15 de noviembre, trébol, and zero em-dashes', () => {
  assert.equal(LETTER_CHAPTERS.length, 6);
  const fullText = LETTER_CHAPTERS.map((c) => `${c.title} ${c.lines.join(' ')}`).join(' ');
  assert.ok(!fullText.includes('—'));
  assert.ok(fullText.includes('amorcitos'));
  assert.ok(!fullText.includes('novios'));
  assert.ok(fullText.includes('15 de noviembre'));
  assert.ok(fullText.includes('trébol'));
});

test('the last chapter is a dedicated closing scene signed with cariño by Fabian', () => {
  const closing = LETTER_CHAPTERS[LETTER_CHAPTERS.length - 1];
  assert.equal(closing.isClosing, true);
  assert.equal(closing.title, 'Con mucho cariño,');
  assert.deepEqual(closing.lines, ['Fabian']);
});

test('only Futile Devices is configured as background track', () => {
  assert.equal(FUTILE_DEVICES_TRACK.title, 'Futile Devices');
  assert.equal(FUTILE_DEVICES_TRACK.youtubeId, 'UEBPTUbpLoY');
});

test('slicePointsByDrawProgress progressively reveals stroke points from 0 to 1', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ];
  assert.equal(slicePointsByDrawProgress(pts, 0).length, 0);
  const half = slicePointsByDrawProgress(pts, 0.5);
  assert.equal(half.length, 3);
  assert.equal(half[2].x, 15);
  assert.equal(slicePointsByDrawProgress(pts, 1).length, 4);
});

test('computeNarrativeState progresses across all 6 scenes and animates braceletStrokeDrawProgress', () => {
  const startState = computeNarrativeState(0);
  assert.equal(startState.activeChapterIndex, 0);
  assert.equal(startState.braceletToHeartMorph, 0);
  assert.equal(startState.braceletStrokeDrawProgress, 0);

  const braceletState = computeNarrativeState(0.25);
  assert.equal(braceletState.activeChapterIndex, 1);
  assert.ok(braceletState.braceletStrokeDrawProgress > 0.95);

  const heartState = computeNarrativeState(0.96);
  assert.equal(heartState.activeChapterIndex, 5);
  assert.equal(LETTER_CHAPTERS[heartState.activeChapterIndex].isClosing, true);
  assert.ok(heartState.braceletToHeartMorph > 0.95);
  assert.ok(heartState.heartSceneWeight > 0.95);
});

test('sampleCloverToHeartPoints interpolates from dangling clover charm at 0 to inner heart at 1', () => {
  const scale = 100;
  const cloverPts = sampleCloverToHeartPoints(64, scale, 0);
  const heartPts = sampleCloverToHeartPoints(64, scale, 1);
  const braceletPts = sampleBraceletToHeartPoints(64, scale, 1);

  assert.equal(cloverPts.length, 64);
  assert.equal(heartPts.length, 64);
  assert.equal(braceletPts.length, 64);

  const expectedFirstClover = getCloverCharmPoint(0, scale);
  assert.ok(Math.abs(cloverPts[0].x - expectedFirstClover.x) < 1e-6);
  assert.ok(Math.abs(cloverPts[0].y - expectedFirstClover.y) < 1e-6);

  const expectedFirstHeart = getHeartPoint(0, scale * 0.52);
  assert.ok(Math.abs(heartPts[0].x - expectedFirstHeart.x) < 1e-6);
  assert.ok(Math.abs(heartPts[0].y - expectedFirstHeart.y) < 1e-6);
});

test('extractYouTubeId parses direct IDs and various YouTube URL formats', () => {
  assert.equal(extractYouTubeId('UEBPTUbpLoY'), 'UEBPTUbpLoY');
  assert.equal(extractYouTubeId('invalid-url'), null);
});
