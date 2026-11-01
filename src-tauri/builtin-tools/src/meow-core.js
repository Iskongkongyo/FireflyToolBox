// 源自项目根目录流萤喵语.html；保留四字符三连映射与自动识别算法。
export const B64_ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export const DEFAULT_CHARS="流萤喵～";
function isInvisible(c) {
      if (c.trim() === '') return true;
      const cp = c.codePointAt(0);
      return cp === 0x200B || cp === 0x200C || cp === 0x200D || cp === 0x2060 || cp === 0xFEFF;
    }

function sanitizeChars(str) {
      return [...str].filter(c => !isInvisible(c)).join('');
    }

function utf8ToBase64(str) {
      const bytes = new TextEncoder().encode(str);
      let binString = "";
      for (let i = 0; i < bytes.byteLength; i++) binString += String.fromCharCode(bytes[i]);
      return btoa(binString);
    }

function strictBase64ToUtf8(base64) {
      const binString = atob(base64);
      const bytes = new Uint8Array(binString.length);
      for (let i = 0; i < binString.length; i++) bytes[i] = binString.charCodeAt(i);
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }

function getPermutations(items) {
      if (items.length <= 1) return [items.slice()];
      const result = [];
      for (let i = 0; i < items.length; i++) {
        const rest = items.slice(0, i).concat(items.slice(i + 1));
        for (const tail of getPermutations(rest)) result.push([items[i], ...tail]);
      }
      return result;
    }

function normalizeCipherInput(rawInput) {
  let input=[...rawInput.trim()].filter(c=>! /\s/u.test(c)).join('');
  const prefix='喵呜...',suffix='喵～',length=[...input].length;
  if(input.startsWith(prefix)&&input.endsWith(suffix)&&(length-7)%3===0)input=input.slice(prefix.length,-suffix.length);
  else if(input.startsWith(prefix)&&(length-5)%3===0)input=input.slice(prefix.length);
  else if(input.endsWith(suffix)&&(length-2)%3===0)input=input.slice(0,-suffix.length);
  return [...input];
}

function looksLikeCipherStructure(rawInput, minLength = 12) {
      const cipherChars = normalizeCipherInput(rawInput);
      if (cipherChars.length < minLength || cipherChars.length % 3 !== 0) return false;
      const uniqueChars = [...new Set(cipherChars)];
      return uniqueChars.length === 4 && !uniqueChars.some(isInvisible);
    }

function scoreDecodedText(text) {
      const chars = [...text];
      if (!chars.length) return -Infinity;

      const commonPunctuation = new Set([...".,!?;:'\"()[]{}-_/@#%&+=*<>，。！？：；、“”‘’（）【】《》…—~～`"]);
      let score = 0;

      for (const c of chars) {
        const cp = c.codePointAt(0);
        if ((cp < 32 && c !== '\n' && c !== '\r' && c !== '\t') || cp === 0x7F) return -Infinity;

        if (/\s/u.test(c)) score += 2.6;
        else if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(c)) score += 3.3;
        else if (/^\p{L}$/u.test(c)) score += 3.0;
        else if (/^\p{N}$/u.test(c)) score += 2.5;
        else if (commonPunctuation.has(c)) score += 1.25;
        else if (/^[\p{P}\p{S}]$/u.test(c)) score += 0.7;
        else score += 0.35;
      }

      let avg = score / chars.length;

      /* 常见结构可显著提高置信度：网址、邮箱、JSON、自然英文单词等。 */
      if (/https?:\/\//i.test(text)) avg += 0.5;
      if (/\b(?:www\.)?[A-Za-z0-9-]+\.[A-Za-z]{2,}\b/.test(text)) avg += 0.25;
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())) avg += 0.35;

      try {
        const trimmed = text.trim();
        if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && JSON.parse(trimmed) !== undefined) avg += 0.8;
      } catch (e) {}

      const whitespaceRatio = chars.filter(c => /\s/u.test(c)).length / chars.length;
      if (whitespaceRatio > 0) avg += Math.min(0.35, whitespaceRatio * 2);

      const englishWords = text.toLowerCase().match(/[a-z]{3,}/g) || [];
      if (englishWords.length) {
        let vowelLikeWords = 0;
        let bigramHits = 0;
        let bigramTotal = 0;
        const commonBigrams = new Set('th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng se ha as ou io le ve co me de hi ri ro ic ne ea ra ce li ch ll be ma si om ur el lo wo rl ld'.split(' '));

        for (const word of englishWords) {
          const vowelRatio = [...word].filter(c => 'aeiouy'.includes(c)).length / word.length;
          if (vowelRatio >= 0.15 && vowelRatio <= 0.7) vowelLikeWords++;
          for (let i = 0; i < word.length - 1; i++) {
            bigramTotal++;
            if (commonBigrams.has(word.slice(i, i + 2))) bigramHits++;
          }
        }

        avg += 0.18 * (vowelLikeWords / englishWords.length);
        if (bigramTotal) avg += 0.45 * (bigramHits / bigramTotal);
      }

      /* 循环解密场景：正确结果可能不是自然语言，而是下一层“四字符三连”密文。 */
      if (looksLikeCipherStructure(text, 12)) avg += 2.7;

      return avg;
    }

function tryDecodeWithMapping(cipherChars, mappingChars) {
      const digitMap = new Map(mappingChars.map((c, i) => [c, i]));
      let b64Str = '';

      for (let i = 0; i < cipherChars.length; i += 3) {
        const d0 = digitMap.get(cipherChars[i]);
        const d1 = digitMap.get(cipherChars[i + 1]);
        const d2 = digitMap.get(cipherChars[i + 2]);
        if (d0 === undefined || d1 === undefined || d2 === undefined) return null;
        b64Str += B64_ALPHABET[d0 * 16 + d1 * 4 + d2];
      }

      if (b64Str.length % 4 === 1) return null;
      let padded = b64Str;
      const remainder = padded.length % 4;
      if (remainder === 2) padded += '==';
      else if (remainder === 3) padded += '=';

      try {
        const decoded = strictBase64ToUtf8(padded);
        if (utf8ToBase64(decoded).replace(/=/g, '') !== b64Str) return null;
        return { decoded, score: scoreDecodedText(decoded) };
      } catch (e) {
        return null;
      }
    }

function detectMappingFromInput(rawInput) {
      const cipherChars = normalizeCipherInput(rawInput);

      /* 太短时映射顺序容易出现歧义，因此自动识别只处理较完整密文。 */
      if (cipherChars.length < 12 || cipherChars.length % 3 !== 0) return null;

      const uniqueChars = [...new Set(cipherChars)];
      if (uniqueChars.length !== 4 || uniqueChars.some(isInvisible)) return null;

      const candidates = [];
      for (const permutation of getPermutations(uniqueChars)) {
        const result = tryDecodeWithMapping(cipherChars, permutation);
        if (result && Number.isFinite(result.score)) {
          candidates.push({ chars: permutation, decoded: result.decoded, score: result.score });
        }
      }

      if (!candidates.length) return null;
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      const second = candidates[1];

      /* 保守识别：自然文本与“下一层密文”都允许，但最佳排列需明显优于其它排列。 */
      const decoded = best.decoded.trim();
      const isNestedCipher = looksLikeCipherStructure(decoded, 12);
      const hasCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(decoded);
      const hasWhitespace = /\s/u.test(decoded);
      const hasKnownStructure = /https?:\/\//i.test(decoded) ||
        /\b(?:www\.)?[A-Za-z0-9-]+\.[A-Za-z]{2,}\b/.test(decoded) ||
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(decoded);
      const minScore = isNestedCipher ? 2.7 : (hasCjk ? 2.2 : (hasKnownStructure || hasWhitespace ? 2.6 : 3.0));
      const minGap = cipherChars.length < 36 ? 0.18 : 0.12;

      if (best.score < minScore) return null;
      if (second && best.score - second.score < minGap) return null;

      return best;
    }

function decodeStrictWithCustomMapping(rawInput, mappingChars) {
      if (!mappingChars || mappingChars.length !== 4) return null;
      const cipherChars = normalizeCipherInput(rawInput);
      if (!cipherChars.length || cipherChars.length % 3 !== 0) return null;
      if (cipherChars.some(c => !mappingChars.includes(c))) return null;
      return tryDecodeWithMapping(cipherChars, mappingChars);
    }
export {isInvisible,sanitizeChars,utf8ToBase64,normalizeCipherInput,looksLikeCipherStructure,tryDecodeWithMapping,detectMappingFromInput,decodeStrictWithCustomMapping};
