package service

import (
	"errors"

	"github.com/mhsanaei/3x-ui/v3/internal/database"
	"github.com/mhsanaei/3x-ui/v3/internal/database/model"

	"gorm.io/gorm"
)

const (
	defaultClientActivityPageSize = 100
	maxClientActivityPageSize     = 200
	maxClientActivityPage         = 100000
)

type ClientActivityListItem struct {
	Destination   string `json:"destination"`
	SourceIP      string `json:"sourceIp"`
	UploadBytes   int64  `json:"uploadBytes"`
	DownloadBytes int64  `json:"downloadBytes"`
}

type ClientActivityListResponse struct {
	Enabled    bool                     `json:"enabled"`
	Generation int64                    `json:"generation"`
	DataEpoch  int64                    `json:"dataEpoch"`
	Items      []ClientActivityListItem `json:"items"`
	Total      int64                    `json:"total"`
	Page       int                      `json:"page"`
	PageSize   int                      `json:"pageSize"`
}

func normalizeClientActivityPage(
	page int,
	pageSize int,
) (int, int) {
	if page < 1 {
		page = 1
	}
	if page > maxClientActivityPage {
		page = maxClientActivityPage
	}

	if pageSize < 1 {
		pageSize = defaultClientActivityPageSize
	}
	if pageSize > maxClientActivityPageSize {
		pageSize = maxClientActivityPageSize
	}

	return page, pageSize
}

// ListByClientID returns only the client's current data epoch. Rows left from
// an older Reset epoch can therefore never appear in the API response even if
// delayed cleanup or a transaction rollback has preserved them temporarily.
func (s *ClientActivityService) ListByClientID(
	clientID int,
	page int,
	pageSize int,
) (*ClientActivityListResponse, error) {
	page, pageSize = normalizeClientActivityPage(
		page,
		pageSize,
	)

	response := &ClientActivityListResponse{
		DataEpoch: 1,
		Items:     []ClientActivityListItem{},
		Page:      page,
		PageSize:  pageSize,
	}

	if clientID <= 0 {
		return response, nil
	}

	db := database.GetDB()

	var setting model.ClientActivitySetting

	err := db.
		Where("client_id = ?", clientID).
		First(&setting).
		Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return response, nil
	}
	if err != nil {
		return nil, err
	}

	response.Enabled = setting.Enabled
	response.Generation = setting.Generation
	response.DataEpoch = setting.DataEpoch

	query := db.
		Model(&model.ClientActivityDestination{}).
		Where(
			"client_id = ? AND data_epoch = ?",
			clientID,
			setting.DataEpoch,
		)

	if err := query.Count(&response.Total).Error; err != nil {
		return nil, err
	}

	offset := (page - 1) * pageSize

	if err := query.
		Select(
			"destination",
			"source_ip",
			"upload_bytes",
			"download_bytes",
		).
		Order("last_seen DESC").
		Order("id DESC").
		Limit(pageSize).
		Offset(offset).
		Scan(&response.Items).
		Error; err != nil {
		return nil, err
	}

	if response.Items == nil {
		response.Items = []ClientActivityListItem{}
	}

	return response, nil
}
