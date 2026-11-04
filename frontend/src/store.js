// What a student has done on this device: finished passages and collected words. Kept in this browser only.
const AK = 'sa-activity', WK = 'sa-words'
const read = k => { try { return JSON.parse(localStorage.getItem(k) || '[]') } catch { return [] } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage can be blocked */ } window.dispatchEvent(new Event('sa-activity')) }

export const loadActivity = () => read(AK)
export const loadWords = () => read(WK)
export function addActivity(rec) { write(AK, [...read(AK), rec].slice(-100)) }
export function addWords(list, passage) {
  const have = new Set(read(WK).map(x => x.w.toLowerCase()))
  const add = list.filter(w => !have.has(w.toLowerCase())).map(w => ({ w, p: passage, at: new Date().toISOString() }))
  if (add.length) write(WK, [...read(WK), ...add].slice(-500))
}
export const clearActivity = () => write(AK, [])
export const clearWords = () => write(WK, [])
