import { CropperDimensions, ShowErrorObject } from '@/app/types'
import { useRouter } from 'next/navigation'
import { Cropper } from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';
import React, { useEffect, useState } from 'react'
import { BsPencil } from "react-icons/bs";
import { AiOutlineClose } from "react-icons/ai";
import { BiLoaderCircle } from "react-icons/bi";
import TextInput from '../TextInput';
import { useGeneralStore } from '@/app/stores/general';
import { useUser } from '@/app/context/user';
import useUpdateProfile from '@/app/hooks/useUpdateProfile';
import useChangeUserImage, { deletePreviousAvatar } from '@/app/hooks/useChangeUserImage';
import useUpdateProfileImage from '@/app/hooks/useUpdateProfileImage';
import useCreateBucketUrl from '@/app/hooks/useCreateBucketUrl';
import { fetchProfile } from '@/app/utils/feed';
import { showToast } from '@/app/utils/toast';
import { handleError } from '@/app/utils/handle';
import { checkHandleAvailable, setHandle } from '@/app/utils/handleRpc';

const EditProfileOverlay = () => {
    let { setIsEditProfileOpen } = useGeneralStore()

    const contextUser = useUser()
    const router = useRouter()

    const [file, setFile] = useState<File | null>(null);
    const [cropper, setCropper] = useState<CropperDimensions | null>(null);
    const [uploadedImage, setUploadedImage] = useState<string | null>(null);
    const [userImage, setUserImage] = useState<string | ''>('');
    const [userName, setUserName] = useState<string | ''>('');
    const [userBio, setUserBio] = useState<string | ''>('');
    const [userHandle, setUserHandle] = useState<string | ''>('');
    // What the handle was when the form loaded, so a Save that never touched
    // this field can skip set_handle entirely -- see updateUserInfo below.
    const [originalHandle, setOriginalHandle] = useState<string | ''>('');
    const [handleAvailability, setHandleAvailability] = useState<
        'idle' | 'checking' | 'available' | 'taken'
    >('idle');
    const [isUpdating, setIsUpdating] = useState(false);
    const [isLoadingProfile, setIsLoadingProfile] = useState(true);
    const [error, setError] = useState<ShowErrorObject | null>(null)

    const userId = contextUser?.user?.id

    /**
     * Read straight from get_profile rather than useProfileStore.
     *
     * Nothing ever populated that store -- the profile page stopped using it --
     * so this form opened blank, with a broken avatar, and saved an empty id.
     */
    useEffect(() => {
        if (!userId) return

        let active = true
        setIsLoadingProfile(true)

        fetchProfile(userId)
            .then((profile) => {
                if (!active || !profile) return
                setUserName(profile.name || '')
                setUserBio(profile.bio || '')
                setUserImage(profile.image || '')
                setUserHandle(profile.handle || '')
                setOriginalHandle(profile.handle || '')
            })
            .catch((error) => {
                console.error(error)
                if (active) showToast('Could not load your profile', 'error')
            })
            .finally(() => {
                if (active) setIsLoadingProfile(false)
            })

        return () => { active = false }
    }, [userId])

    /**
     * Availability is checked live, on a debounce, so the field can tell the
     * user "taken" before they ever hit Save -- but only after handleError
     * passes locally. A malformed handle ("Al!ce") would otherwise fire a
     * round trip per keystroke for a value that can never be valid, and
     * handle_available would just echo back the same charset failure
     * handleError already caught for free.
     *
     * An unchanged handle skips the check entirely: set_handle treats
     * "already yours" as a no-op (see 0011's `if v_old = p_handle`), so
     * asking handle_available here would either reservation-match the
     * caller's own row (available) or, if the RPC's self-exclusion ever
     * drifted, wrongly report their own handle as taken.
     */
    useEffect(() => {
        if (!userHandle || userHandle === originalHandle || handleError(userHandle)) {
            setHandleAvailability('idle')
            return
        }

        let active = true
        setHandleAvailability('checking')

        const timer = setTimeout(async () => {
            try {
                const available = await checkHandleAvailable(userHandle)
                if (active) setHandleAvailability(available ? 'available' : 'taken')
            } catch (err) {
                console.error(err)
                // Advisory only -- a failed check should not block typing or
                // pretend to know an answer it doesn't have.
                if (active) setHandleAvailability('idle')
            }
        }, 300)

        return () => {
            active = false
            clearTimeout(timer)
        }
    }, [userHandle, originalHandle])

    const getUploadedImage = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = event.target.files && event.target.files[0];

        if (selectedFile) {
            setFile(selectedFile);
            setUploadedImage(URL.createObjectURL(selectedFile));
        } else {
            setFile(null);
            setUploadedImage(null);
        }
    }

    const updateUserInfo = async () => {
        let isError = validate()
        if (isError) return
        if (!userId) return

        try {
            setIsUpdating(true)

            // Skipped entirely when unchanged: set_handle itself treats
            // "already yours" as a no-op, but making that round trip every
            // time only Name or Bio changed would be pure waste -- and it
            // would mean a signed-out/lost-the-race failure on a field the
            // user never touched could block an otherwise-fine save.
            if (userHandle !== originalHandle) {
                try {
                    await setHandle(userHandle)
                } catch (handleErr: any) {
                    // set_handle RAISEs a specific, already user-facing
                    // message per failure -- 23505 taken, 22023 malformed,
                    // 28000 signed out -- and rendering it as-is is what's
                    // required here. A raise is the EXPECTED outcome of two
                    // people racing for the same handle, not a crash, so
                    // this is a normal return, not a rethrow.
                    console.error(handleErr)
                    setError({
                        type: 'handle',
                        message: handleErr?.message || 'Could not save your handle',
                    })
                    return
                }
                setOriginalHandle(userHandle)
            }

            await useUpdateProfile(userId, userName.trim(), userBio.trim())

            // Refreshes the name and avatar the top nav renders from context.
            await contextUser?.checkUser()
            setIsEditProfileOpen(false)
            showToast('Profile updated')
            router.refresh()
        } catch (error) {
            // Was swallowed into console.log, and isUpdating was never reset --
            // a failed save left the button spinning with nothing to explain it.
            console.error(error)
            showToast('Could not save your profile', 'error')
        } finally {
            setIsUpdating(false)
        }
    }

    const cropAndUpdateImage = async () => {
        let isError = validate()
        if (isError) return
        if (!userId) return

        if (!file || !cropper) {
            showToast('Choose an image first', 'error')
            return
        }

        try {
            setIsUpdating(true)

            const previousImage = userImage
            const newImageId = await useChangeUserImage(file, cropper)
            await useUpdateProfileImage(userId, newImageId)

            // Only now is the old file safe to remove: until the row above is
            // written, it is still the avatar the profile points at.
            await deletePreviousAvatar(previousImage)

            setUserImage(newImageId)
            await contextUser?.checkUser()
            setIsEditProfileOpen(false)
            showToast('Profile photo updated')
            router.refresh()
        } catch (error) {
            console.error(error)
            showToast('Could not update your profile photo', 'error')
        } finally {
            setIsUpdating(false)
        }
    }

    const showError = (type: string) => {
        if (error && Object.entries(error).length > 0 && error?.type == type) {
            return error.message
        }
        return ''
    }

    const validate = () => {
        setError(null)
        let isError = false
        // Only the first problem found is shown -- setError only ever holds
        // one message, so if both fields are invalid the later check would
        // otherwise silently clobber the earlier one.
        let firstError: ShowErrorObject | null = null

        if (!userName) {
            firstError = firstError ?? { type: 'userName', message: 'A name is required' }
            isError = true
        }

        // handleAvailability is advisory (see the debounce effect above), so
        // Save re-runs handleError itself rather than trusting a "taken"/
        // "available" that may be stale from a keystroke ago. Skipped
        // entirely when the handle did not change, matching set_handle's own
        // no-op-on-unchanged behaviour.
        if (userHandle !== originalHandle) {
            const handleMessage = handleError(userHandle)
            if (handleMessage) {
                firstError = firstError ?? { type: 'handle', message: handleMessage }
                isError = true
            } else if (handleAvailability === 'taken') {
                firstError = firstError ?? { type: 'handle', message: 'That handle is taken' }
                isError = true
            }
        }

        if (firstError) setError(firstError)
        return isError
    }

  return (
    <>
       <div
            id="EditProfileOverlay"
            className="fixed flex justify-center pt-14 md:pt-[105px] z-50 top-0 left-0 w-full h-full bg-black bg-opacity-50 overflow-auto"
        >
            <div
                className={`
                    relative bg-surface w-full max-w-[700px] sm:h-[580px] h-[655px] mx-3 p-4 rounded-lg mb-10
                    ${!uploadedImage ? 'h-[655px]' : 'h-[580px]'}
                `}
            >
                <div className="absolute flex items-center justify-between w-full p-5 left-0 top-0 border-b border-line">
                    <h1 className="text-[22px] font-medium text-ink">
                        Edit profile
                    </h1>
                    <button
                        disabled={isUpdating}
                        onClick={() => setIsEditProfileOpen(false)}
                        className="hover:bg-surface-subtle p-1 rounded-full text-ink"
                    >
                        <AiOutlineClose size="25"/>
                    </button>
                </div>

                <div className={`h-[calc(500px-200px)] ${!uploadedImage ? 'mt-16' : 'mt-[58px]'}`}>

                    {isLoadingProfile ? (
                        <div className="flex h-full items-center justify-center">
                            <BiLoaderCircle className="animate-spin text-ink-soft" size="30" />
                        </div>
                    ) : !uploadedImage ? (
                        <div>
                            <div
                                id="ProfilePhotoSection"
                                className="flex flex-col border-b border-line sm:h-[118px] h-[145px] px-1.5 py-2 w-full"
                            >
                                <h3 className="font-semibold text-[15px] sm:mb-0 mb-1 text-ink sm:w-[160px] sm:text-left text-center">
                                    Profile photo
                                </h3>

                                <div className="flex items-center justify-center sm:-mt-6">
                                    <label htmlFor="image" className="relative cursor-pointer">

                                        <img className="rounded-full" width="95" src={useCreateBucketUrl(userImage)} />

                                        <button className="absolute bottom-0 right-0 rounded-full bg-surface shadow-xl border p-1 border-line inline-block w-[32px] h-[32px] text-ink">
                                            <BsPencil size="17" className="ml-0.5"/>
                                        </button>
                                    </label>
                                    <input
                                        className="hidden"
                                        type="file"
                                        id="image"
                                        onChange={getUploadedImage}
                                        accept="image/png, image/jpeg, image/jpg"
                                    />
                                </div>
                            </div>

                            <div
                                id="UserNameSection"
                                className="flex flex-col border-b border-line sm:h-[118px]  px-1.5 py-2 mt-1.5  w-full"
                            >
                                <h3 className="font-semibold text-[15px] sm:mb-0 mb-1 text-ink sm:w-[160px] sm:text-left text-center">
                                    Name
                                </h3>

                                <div className="flex items-center justify-center sm:-mt-6">
                                    <div className="sm:w-[60%] w-full max-w-md">

                                        <TextInput
                                            string={userName}
                                            placeholder="Name"
                                            onUpdate={setUserName}
                                            inputType="text"
                                            error={showError('userName')}
                                        />

                                        <p className={`relative text-[11px] text-ink-soft ${error ? 'mt-1' : 'mt-4'}`}>
                                            This is the display name shown on your profile and posts.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div
                                id="UserHandleSection"
                                className="flex flex-col border-b border-line sm:h-[118px]  px-1.5 py-2 mt-1.5  w-full"
                            >
                                <h3 className="font-semibold text-[15px] sm:mb-0 mb-1 text-ink sm:w-[160px] sm:text-left text-center">
                                    Username
                                </h3>

                                <div className="flex items-center justify-center sm:-mt-6">
                                    <div className="sm:w-[60%] w-full max-w-md">

                                        <TextInput
                                            string={userHandle}
                                            placeholder="username"
                                            onUpdate={setUserHandle}
                                            inputType="text"
                                            error={showError('handle')}
                                        />

                                        {/* Live availability, not a substitute for set_handle's own
                                            check on Save -- handle_available is advisory only (see
                                            app/utils/handleRpc.ts), a stale "available" here can never
                                            get past validate(). */}
                                        <p
                                            className={`relative text-[11px] ${
                                                handleAvailability === 'taken'
                                                    ? 'text-red-500'
                                                    : handleAvailability === 'available'
                                                    ? 'text-green-600'
                                                    : 'text-ink-soft'
                                            } ${error ? 'mt-1' : 'mt-4'}`}
                                        >
                                            {handleAvailability === 'checking' && 'Checking availability…'}
                                            {handleAvailability === 'available' && 'This username is available.'}
                                            {handleAvailability === 'taken' && 'That username is taken.'}
                                            {handleAvailability === 'idle' &&
                                                'Usernames can only contain letters, numbers, underscores, and periods. Changing your username will also change your profile link.'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div
                                id="UserBioSection"
                                className="flex flex-col sm:h-[120px]  px-1.5 py-2 mt-2 w-full"
                            >
                                <h3 className="font-semibold text-[15px] sm:mb-0 mb-1 text-ink sm:w-[160px] sm:text-left text-center">
                                    Bio
                                </h3>

                                <div className="flex items-center justify-center sm:-mt-6">
                                    <div className="sm:w-[60%] w-full max-w-md">
                                        <textarea
                                            cols={30}
                                            rows={4}
                                            onChange={e => setUserBio(e.target.value)}
                                            value={userBio || ''}
                                            maxLength={80}
                                            className="
                                                resize-none
                                                w-full
                                                bg-surface-subtle
                                                text-ink
                                                border
                                                border-line
                                                rounded-md
                                                py-2.5
                                                px-3
                                                focus:outline-none
                                            "
                                        ></textarea>
                                        <p className="text-[11px] text-ink-soft">{userBio ? userBio.length : 0}/80</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="w-full max-h-[420px] mx-auto bg-black circle-stencil">
                            <Cropper
                                stencilProps={{ aspectRatio: 1 }}
                                className="h-[400px]"
                                onChange={(cropper) => setCropper(cropper.getCoordinates())}
                                src={uploadedImage}
                            />
                        </div>
                    )}

                </div>


                <div
                    id="ButtonSection"
                    className="absolute p-5 left-0 bottom-0 border-t border-line w-full"
                >
                    {!uploadedImage ? (
                        <div id="UpdateInfoButtons" className="flex items-center justify-end">

                            <button
                                disabled={isUpdating}
                                onClick={() => setIsEditProfileOpen(false)}
                                className="flex items-center border border-line rounded-sm px-3 py-[6px] hover:bg-surface-subtle"
                            >
                                <span className="px-2 font-medium text-[15px] text-ink">Cancel</span>
                            </button>

                            <button
                                disabled={isUpdating}
                                onClick={() => updateUserInfo()}
                                className="flex items-center bg-tiktok text-white rounded-md ml-3 disabled:opacity-60 px-3 py-[6px]"
                            >
                                <span className="mx-4 font-medium text-[15px]">
                                    {isUpdating ? <BiLoaderCircle color="#ffffff" className="my-1 mx-2.5 animate-spin" /> : "Save" }
                                </span>
                            </button>

                        </div>
                    ) : (
                        <div id="CropperButtons" className="flex items-center justify-end" >

                            <button
                                onClick={() => setUploadedImage(null)}
                                className="flex items-center border border-line rounded-sm px-3 py-[6px] hover:bg-surface-subtle"
                            >
                                <span className="px-2 font-medium text-[15px] text-ink">Cancel</span>
                            </button>

                            <button
                                onClick={() => cropAndUpdateImage()}
                                className="flex items-center bg-tiktok text-white rounded-md ml-3 disabled:opacity-60 px-3 py-[6px]"
                            >
                                <span className="mx-4 font-medium text-[15px]">
                                    {isUpdating ? <BiLoaderCircle color="#ffffff" className="my-1 mx-2.5 animate-spin" /> : "Apply" }
                                </span>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    </>
  )
}

export default EditProfileOverlay
