const DEFAULT_AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="#e2e8f0"/><circle cx="48" cy="34" r="14" fill="#475569"/><path d="M24 78c0-13.255 10.745-24 24-24s24 10.745 24 24" fill="#475569"/></svg>`;

export function getDefaultProfilePicture(): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(DEFAULT_AVATAR_SVG)}`;
}
