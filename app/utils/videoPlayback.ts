export const pauseOtherVideos = (currentVideo: HTMLVideoElement | null, selector = 'video') => {
  if (typeof document === 'undefined' || !currentVideo) {
    return
  }

  const videos = document.querySelectorAll<HTMLVideoElement>(selector)

  videos.forEach((video) => {
    if (video !== currentVideo && !video.paused) {
      video.pause()
    }
  })
}
