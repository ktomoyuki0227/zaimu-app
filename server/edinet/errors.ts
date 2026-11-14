/**
 * 画面に出してよい失敗。メッセージには、API キーや URL など、見せてはいけない情報を含めてはならない。
 * これ以外の例外(想定外のもの)は、中身を画面に出さず、汎用の文章にする。
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserFacingError'
  }
}
