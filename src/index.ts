export function reverseString(forward: string): string {
  if (!forward) return forward;

  return forward.split('').reverse().join('');
}

console.log('This is the example typescript application!');
