/** @returns {import('../types').VideoAsset | null} */
function resolveVideoAsset({ avatarRole, currentState } = {}) {
  if (!avatarRole || !currentState) {
    return null
  }

  const assetKey = `${avatarRole}_${currentState}`

  return {
    videoFileId: `placeholder://videos/${assetKey}.mp4`,
    posterFileId: `placeholder://posters/${assetKey}.jpg`,
    assetKey,
    assetSource: 'placeholder_v1',
    durationSeconds: 5
  }
}

module.exports = {
  resolveVideoAsset
}
