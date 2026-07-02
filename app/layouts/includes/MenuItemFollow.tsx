import Link from "next/link";
import { MenuItemFollowCompTypes } from "../../types";
import { AiOutlineCheck } from "react-icons/ai"
import useCreateBucketUrl from "@/app/hooks/useCreateBucketUrl";

const MenuItemFollow = ({ user }: MenuItemFollowCompTypes) => {

  return (
    <>
      <Link
          href={`/profile/${user?.id}`}
          className="flex items-center rounded-md w-full py-1.5 px-2 transition-colors hover:bg-surface-subtle"
      >
          <img
              className="h-[35px] w-[35px] rounded-full object-cover lg:mx-0 mx-auto"
              width="35"
              src={useCreateBucketUrl(user?.image)}
          />
          <div className="hidden min-w-0 lg:block lg:pl-2.5">
              <div className="flex items-center">
                  <p className="truncate text-[14px] font-bold text-ink">
                      {user?.name}
                  </p>
                  <span className="ml-1 inline-flex h-[15px] w-[15px] items-center justify-center rounded-full bg-tiktok-cyan">
                      <AiOutlineCheck color="#FFFFFF" size="9"/>
                  </span>
              </div>
              <p className="truncate text-[12px] font-light text-ink-soft">
                  @{user?.name}
              </p>
          </div>
      </Link>
    </>
  );
};

export default MenuItemFollow;
