package model

// ClientActivitySetting stores the opt-in monitoring state for one client.
//
// Generation changes whenever monitoring is started, stopped, reset, or when
// the client's runtime identity changes. Events carrying an older generation
// must be rejected by the collector.
//
// DataEpoch changes only when activity history is reset. It prevents delayed
// events from an older connection from repopulating data after a reset.
type ClientActivitySetting struct {
	ClientID   int   `json:"clientId" gorm:"primaryKey;column:client_id"`
	Enabled    bool  `json:"enabled" gorm:"default:false;index"`
	Generation int64 `json:"generation" gorm:"default:0;not null"`
	DataEpoch  int64 `json:"dataEpoch" gorm:"column:data_epoch;default:1;not null"`
	CreatedAt  int64 `json:"createdAt" gorm:"autoCreateTime:milli"`
	UpdatedAt  int64 `json:"updatedAt" gorm:"autoUpdateTime:milli"`
}

func (ClientActivitySetting) TableName() string {
	return "client_activity_settings"
}

// ClientActivityDestination stores aggregated traffic for one observed
// destination and source IP. It intentionally does not store individual
// connections, URLs, payloads, credentials, or protocol details.
type ClientActivityDestination struct {
	ID            int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	ClientID      int    `json:"clientId" gorm:"column:client_id;not null;uniqueIndex:uidx_client_activity_destination,priority:1;index:idx_client_activity_list,priority:1"`
	DataEpoch     int64  `json:"dataEpoch" gorm:"column:data_epoch;not null;uniqueIndex:uidx_client_activity_destination,priority:2;index:idx_client_activity_list,priority:2"`
	SourceIP      string `json:"sourceIp" gorm:"column:source_ip;size:45;not null;uniqueIndex:uidx_client_activity_destination,priority:3"`
	Destination   string `json:"destination" gorm:"size:253;not null;uniqueIndex:uidx_client_activity_destination,priority:4"`
	UploadBytes   int64  `json:"uploadBytes" gorm:"column:upload_bytes;default:0;not null"`
	DownloadBytes int64  `json:"downloadBytes" gorm:"column:download_bytes;default:0;not null"`
	LastSeen      int64  `json:"lastSeen" gorm:"column:last_seen;not null;index:idx_client_activity_list,priority:3;index:idx_client_activity_retention"`
	CreatedAt     int64  `json:"createdAt" gorm:"autoCreateTime:milli"`
	UpdatedAt     int64  `json:"updatedAt" gorm:"autoUpdateTime:milli"`
}

func (ClientActivityDestination) TableName() string {
	return "client_activity_destinations"
}
