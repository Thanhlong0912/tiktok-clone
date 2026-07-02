import React from "react";
import TopNav from "./includes/TopNav";

const UploadLayout = ({ children }: { children: React.ReactNode }) => {

  return (
    <>
      <div className="min-h-[100vh] bg-surface-subtle">
        <TopNav />
        <div className="flex justify-between mx-auto w-full px-2 max-w-[1140px]">
          {children}
        </div>
      </div>
    </>
  );
};

export default UploadLayout;
