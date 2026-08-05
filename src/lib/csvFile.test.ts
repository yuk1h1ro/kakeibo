import { describe, expect, it } from 'vitest'
import { chooseSaveMethod } from './csvFile'

// ============================================================
// 保存方法の選び方 (機能198)。
//
// 実際の保存(共有シート・ダウンロード)はブラウザの UI に触るのでテストできない。
// テストできるのは「どの状況でどれを選ぶか」の判断だけなので、そこを純粋関数にしてある。
// ============================================================

describe('chooseSaveMethod', () => {
  it('ホーム画面から起動した PWA では共有シートを優先する(ダウンロードが黙って効かない端末があるため)', () => {
    expect(
      chooseSaveMethod({ canShareFiles: true, canDownload: true, standalone: true })
    ).toBe('share')
  })

  it('ふつうのタブではダウンロードを使う(1タップで終わるため)', () => {
    expect(
      chooseSaveMethod({ canShareFiles: true, canDownload: true, standalone: false })
    ).toBe('download')
  })

  it('PWA でも共有が使えなければダウンロードに倒す', () => {
    expect(
      chooseSaveMethod({ canShareFiles: false, canDownload: true, standalone: true })
    ).toBe('download')
  })

  it('ダウンロードが使えなければ共有シートを使う', () => {
    expect(
      chooseSaveMethod({ canShareFiles: true, canDownload: false, standalone: false })
    ).toBe('share')
  })

  it('どちらも使えなければ新しいタブに表示する(何も起きないまま終わらせない)', () => {
    expect(
      chooseSaveMethod({ canShareFiles: false, canDownload: false, standalone: false })
    ).toBe('newtab')
  })
})
