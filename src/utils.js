import {  getKey, deleteKey, valueExists, publish  } from './momento.js';

/**
 * Checks if all parts of a message exist in cache.
 * @param {string} from - The base key prefix.
 * @param {number} totalParts - Total expected parts.
 * @returns {Promise<boolean>} - True if all parts exist, false otherwise.
 */

export const allThere = async (from, totalParts) => {
    for (let index = 1; index <= totalParts; index++) {
      const key = `${from}-${index}`;
      console.log(`Checking if cache contains: ${key}`);
      
      const exists = await valueExists("cache", key);
      if (!exists) {
        console.log(`Missing part: ${key} (${index}/${totalParts})`);
        return false;
      }
    }
  
    console.log(`All ${totalParts} parts are present in cache.`);
    return true;
};
  
/**
 * Reassembles a multi-part message from the cache and deletes the parts.
 * @param {string} from - The base key prefix.
 * @param {number} totalParts - Number of parts to reassemble.
 * @returns {Promise<string>} - The reconstructed message.
 */

export const pieceTogether = async (from, totalParts) => {
  let message = "";

  for (let index = 1; index <= totalParts; index++) {
    const key = `${from}-${index}`;
    const value = await getKey("cache", key);
    await deleteKey("cache", key);

    message += value ?? "";
  }

  console.log(`Assembled full message: ${message}`);
  return message;
};
  
/**
 * Delays execution for a given number of milliseconds.
 * @param {number} ms - Milliseconds to wait.
 * @returns {Promise<void>}
 */

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sendAnswerInFragments(sdp) {
    const totalParts = 2;
    const mid = Math.ceil(sdp.length / totalParts);
    const fragments = [sdp.slice(0, mid), sdp.slice(mid)];
  
    for (let i = 0; i < fragments.length; i++) {
      await publish('cache', `visitor:abc:inbox`, JSON.stringify({
        from: 'xyz',
        to: 'abc',
        type: 'answer',
        part: (i + 1).toString(),
        totalParts: totalParts.toString(),
        sdpFragment: fragments[i],
      }));
      await sleep(300);
    }
  }