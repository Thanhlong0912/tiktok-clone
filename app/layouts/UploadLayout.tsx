import React from "react";
import TopNav from "./includes/TopNav";

const UploadLayout = ({ children }: { children: React.ReactNode }) => {

  return (
    <>
      <div className="min-h-[100vh] bg-[#F8F8F8] dark:bg-dark">
        <TopNav />
        <div className="flex justify-between mx-auto w-full px-2 max-w-[1140px]">
          {children}
        </div>
      </div>
    </>
  );
};

export default UploadLayout;
