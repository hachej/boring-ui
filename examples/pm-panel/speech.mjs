// The fixed transcripts of the fictional microphone, with word timings (seconds). Shared by the pages and the fake PM door.
// C6: « Sur cette carte ① je veux les protéines en premier, comme sur cette jauge ②. » — 14 s, the picks land at 0:02 and 0:09.
export const words = 'Sur cette carte je veux les protéines en premier, comme sur cette jauge.';
const timing = [[0.4, 0.8], [0.9, 1.3], [1.4, 1.9], [2.6, 2.9], [3.0, 3.5], [3.6, 3.8], [3.9, 4.8], [4.9, 5.2], [5.3, 6.4], [6.6, 7.1], [7.2, 7.5], [7.6, 8.1], [8.2, 8.9]];
export const segments = [{ start: 0.4, end: 8.9, text: words, words: words.split(' ').map((text, index) => ({ start: timing[index][0], end: timing[index][1], text })) }];
// D boards: « On this card ① protein should come before calories, and this gauge ② can go. » — picks at 0:02 and 0:09.
export const wordsEn = 'On this card protein should come before calories, and this gauge can go.';
const timingEn = [[0.3, 0.6], [0.7, 1.0], [1.1, 1.8], [2.4, 2.9], [3.0, 3.4], [3.5, 3.8], [3.9, 4.3], [4.4, 5.3], [5.5, 5.8], [5.9, 6.3], [6.4, 8.8], [9.3, 9.6], [9.7, 10.2]];
export const segmentsEn = [{ start: 0.3, end: 10.2, text: wordsEn, words: wordsEn.split(' ').map((text, index) => ({ start: timingEn[index][0], end: timingEn[index][1], text })) }];
