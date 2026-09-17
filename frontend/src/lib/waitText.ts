/** Texto del tiempo de espera para la pantalla del comensal (estado `waiting`). */
export function waitText(groupsAhead: number, waitMin: [number, number]): string {
  const [a, b] = waitMin
  if (groupsAhead === 0) {
    return `Eres el siguiente · ~${b} min`
  }
  return `Entre ${a} y ${b} min`
}
