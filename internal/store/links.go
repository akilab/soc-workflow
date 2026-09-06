package store

import "github.com/akilab/soc-workflow/internal/model"

// DefaultLinks は、ランチャーに最初から並べておく行き先。
//
// SOC の作業は 1 つの画面では終わらない。アラートを Defender で見て、端末を
// Intune で調べ、アカウントを Entra で止め、Teams で連絡する——という往復が
// 常にある。それが空のまま始まると、結局ブックマークを探しに行くことになり、
// ランチャーがあること自体に気づかれない。
//
// ここに置くのはどのテナントでも同じ入口だけにする。テナント固有の URL
// （Sentinel のワークスペースや Logic App など）は組織ごとに違うので入れない。
// 名前・URL・アイコンはあとから画面上で直せるし、要らないものは消せる。
func DefaultLinks() []*model.AppLink {
	return []*model.AppLink{
		{Key: "link-1", Name: "Defender", URL: "https://security.microsoft.com/", Icon: "defender"},
		{Key: "link-2", Name: "Intune", URL: "https://intune.microsoft.com/", Icon: "intune"},
		{Key: "link-3", Name: "Entra ID", URL: "https://entra.microsoft.com/", Icon: "entra"},
		{Key: "link-4", Name: "Azure", URL: "https://portal.azure.com/", Icon: "azure"},
		{Key: "link-5", Name: "Teams", URL: "https://teams.microsoft.com/", Icon: "teams"},
		{Key: "link-6", Name: "Outlook", URL: "https://outlook.office.com/mail/", Icon: "outlook"},
		{Key: "link-7", Name: "Microsoft 365", URL: "https://www.office.com/", Icon: "m365"},
		{Key: "link-8", Name: "Copilot", URL: "https://copilot.microsoft.com/", Icon: "copilot"},
	}
}
