export function getDefaultProfilePicture(): string {
  return process.env.NEXT_PUBLIC_DEFAULT_PROFILE_PICTURE || "/default-avatar.svg";
}
