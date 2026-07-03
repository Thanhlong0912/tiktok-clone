"use client"

import { useGeneralStore } from "../stores/general";
import AuthOverlay from "./AuthOverlay";
import EditProfileOverlay from "./profile/EditProfileOverlay";
import ClientOnly from "./ClientOnly";
import ToastHost from "./Toast";

export default function AllOverlays() {
  let { isLoginOpen, isEditProfileOpen } = useGeneralStore();
  return (
    <>
        <ClientOnly>
          {isLoginOpen ? <AuthOverlay /> : null}
          {isEditProfileOpen ? <EditProfileOverlay /> : null}
          <ToastHost />
        </ClientOnly>
    </>
  )
}
