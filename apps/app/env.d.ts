declare module '*.ttf' {
  const asset: number;
  export default asset;
}
declare module '*.otf' {
  const asset: number;
  export default asset;
}
declare module '*.png' {
  const asset: number;
  export default asset;
}
// Renderer modules imported for their pure logic may pull .tsx files that import CSS.
declare module '*.css';
