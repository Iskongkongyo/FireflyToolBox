export const DESKTOP_BOX_OFFICE_URL = 'https://piaofang.maoyan.com/i/dashboard/movie'
export const MOBILE_BOX_OFFICE_URL = 'https://piaofang.maoyan.com/box-office?ver=normal'
export const boxOfficeUrl = (mobile: boolean) => mobile ? MOBILE_BOX_OFFICE_URL : DESKTOP_BOX_OFFICE_URL
